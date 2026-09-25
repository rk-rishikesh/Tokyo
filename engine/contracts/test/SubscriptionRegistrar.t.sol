// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

import {SubscriptionRegistrar} from "../src/SubscriptionRegistrar.sol";
import {IPermissionedRegistry} from "../src/interfaces/IPermissionedRegistry.sol";
import {IPermissionedResolver} from "../src/interfaces/IPermissionedResolver.sol";
import {RecallRoles} from "../src/RegistryRoles.sol";
import {MockERC20, MockRegistry, MockResolver} from "./mocks/Mocks.sol";

contract SubscriptionRegistrarTest is Test {
    MockERC20 internal token;
    MockRegistry internal registry;
    MockResolver internal resolver;
    SubscriptionRegistrar internal registrar;

    address internal publisher = makeAddr("publisher");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal constant PRICE = 10_000_000; // 10 USDC at 6 decimals
    uint64 internal constant TERM = 30 days;
    bytes32 internal constant COLLECTION_NODE = keccak256("exploits.auditor.eth");

    function setUp() public {
        token = new MockERC20();
        registry = new MockRegistry();
        resolver = new MockResolver();

        registrar = new SubscriptionRegistrar(
            IPermissionedRegistry(address(registry)),
            IERC20(address(token)),
            publisher,
            IPermissionedResolver(address(resolver)),
            COLLECTION_NODE,
            PRICE,
            TERM
        );

        // deploy-collection.ts grants the registrar the registrar role on the
        // collection's own subregistry.
        registry.setRegistrar(address(registrar), true);

        token.mint(alice, 100 * PRICE);
        token.mint(bob, 100 * PRICE);

        // Start at a realistic timestamp; expiry maths at t=0 hides bugs.
        vm.warp(1_757_745_600);
    }

    function _subscribeAs(address who) internal returns (uint256) {
        vm.startPrank(who);
        token.approve(address(registrar), PRICE);
        uint256 tokenId = registrar.subscribe(who);
        vm.stopPrank();
        return tokenId;
    }

    // ---------------------------------------------------------------- happy path

    function test_subscribe_mintsLiveSubnameAndForwardsPayment() public {
        uint256 tokenId = _subscribeAs(alice);

        assertTrue(registrar.isActive(alice), "alice should hold a live subscription");
        assertEq(registrar.expiryOf(alice), uint64(block.timestamp) + TERM, "expiry is now + term");
        assertEq(registry.ownerOf(registrar.labelFor(alice)), alice, "alice owns the name");
        assertGt(tokenId, 0);

        assertEq(token.balanceOf(publisher), PRICE, "payment forwarded to the publisher");
        assertEq(token.balanceOf(address(registrar)), 0, "registrar holds no funds");
    }

    function test_subscribe_labelIsLowercaseHexOfSubscriber() public view {
        assertEq(
            registrar.labelFor(address(0xABc0000000000000000000000000000000000123)),
            "sub-0xabc0000000000000000000000000000000000123"
        );
    }

    function test_subscribe_emitsSubscribed() public {
        vm.startPrank(alice);
        token.approve(address(registrar), PRICE);
        vm.expectEmit(true, false, false, true);
        emit SubscriptionRegistrar.Subscribed(
            alice, registry.findTokenId(registrar.labelFor(alice)), uint64(block.timestamp) + TERM
        );
        registrar.subscribe(alice);
        vm.stopPrank();
    }

    /// @dev The subscriber must be able to publish their own `pubkey`, and nothing
    ///      else. `setPubkey` checks `resource(node, 0)`, so that is the resource
    ///      the grant has to land on — a grant anywhere else silently fails open
    ///      or shut at read time.
    function test_subscribe_grantsPubkeyRightsScopedToOwnNameOnly() public {
        _subscribeAs(alice);

        uint256 expected = uint256(keccak256(abi.encode(registrar.nodeFor(alice), bytes32(0))));
        assertEq(resolver.grantCount(), 1, "exactly one grant");
        (uint256 resource, uint256 roleBitmap, address account) = resolver.grants(0);
        assertEq(resource, expected, "granted on resource(node, 0)");
        assertEq(roleBitmap, RecallRoles.ROLE_SET_PUBKEY, "only the pubkey role");
        assertEq(account, alice);

        // Alice has no rights on Bob's subscription name.
        uint256 bobsResource = uint256(keccak256(abi.encode(registrar.nodeFor(bob), bytes32(0))));
        assertFalse(resolver.hasRoles(bobsResource, RecallRoles.ROLE_SET_PUBKEY, alice));
    }

    function test_subscribe_onBehalfOfAnotherAddress() public {
        vm.startPrank(alice);
        token.approve(address(registrar), PRICE);
        registrar.subscribe(bob);
        vm.stopPrank();

        assertTrue(registrar.isActive(bob), "bob holds the subscription");
        assertFalse(registrar.isActive(alice), "alice paid but holds nothing");
        assertEq(token.balanceOf(alice), 100 * PRICE - PRICE, "alice paid");
    }

    function test_isActive_isFalseForAStranger() public view {
        assertFalse(registrar.isActive(bob));
        assertEq(registrar.expiryOf(bob), 0);
    }

    // ------------------------------------------------------------------ payment

    function test_subscribe_revertsOnInsufficientAllowance() public {
        vm.startPrank(alice);
        token.approve(address(registrar), PRICE - 1);
        vm.expectRevert(bytes("ERC20: insufficient allowance"));
        registrar.subscribe(alice);
        vm.stopPrank();

        assertFalse(registrar.isActive(alice), "no name minted when payment fails");
    }

    function test_subscribe_revertsOnInsufficientBalance() public {
        address broke = makeAddr("broke");
        vm.startPrank(broke);
        token.approve(address(registrar), PRICE);
        vm.expectRevert(bytes("ERC20: insufficient balance"));
        registrar.subscribe(broke);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ renewal

    /// @dev Extending from `now` rather than from the current expiry would
    ///      confiscate the unused remainder of a term the subscriber has paid for.
    function test_subscribe_twiceExtendsFromExpiryNotFromNow() public {
        _subscribeAs(alice);
        uint64 firstExpiry = registrar.expiryOf(alice);

        vm.warp(block.timestamp + 10 days);
        _subscribeAs(alice);

        assertEq(registrar.expiryOf(alice), firstExpiry + TERM, "extends from the old expiry");
        assertTrue(
            registrar.expiryOf(alice) > uint64(block.timestamp) + TERM,
            "the unused 20 days survived the renewal"
        );
        assertEq(token.balanceOf(publisher), 2 * PRICE, "charged twice");
    }

    function test_renewal_doesNotRegrantPubkeyRights() public {
        _subscribeAs(alice);
        assertEq(resolver.grantCount(), 1);
        vm.warp(block.timestamp + 1 days);
        _subscribeAs(alice);
        assertEq(resolver.grantCount(), 1, "renewal is not a fresh registration");
    }

    // -------------------------------------------------------------------- lapse

    function test_subscription_lapsesWithoutAnyTransaction() public {
        _subscribeAs(alice);
        assertTrue(registrar.isActive(alice));

        vm.warp(registrar.expiryOf(alice) + 1);

        assertFalse(registrar.isActive(alice), "lapsed with no revocation transaction");
    }

    function test_subscribe_afterLapseStartsFromNow() public {
        _subscribeAs(alice);
        vm.warp(registrar.expiryOf(alice) + 100 days);

        _subscribeAs(alice);

        assertEq(registrar.expiryOf(alice), uint64(block.timestamp) + TERM, "restarts from now");
        assertTrue(registrar.isActive(alice));
    }

    function test_subscribe_afterLapseRegrantsPubkeyRights() public {
        _subscribeAs(alice);
        vm.warp(registrar.expiryOf(alice) + 100 days);
        _subscribeAs(alice);
        assertEq(resolver.grantCount(), 2, "re-registration re-grants");
    }

    // ------------------------------------------------------------------ pricing

    function test_price_returnsConstructorValues() public view {
        (uint256 amount, uint64 term) = registrar.price();
        assertEq(amount, PRICE);
        assertEq(term, TERM);
    }

    function test_setPrice_publisherOnly() public {
        vm.prank(publisher);
        registrar.setPrice(5_000_000, 7 days);

        (uint256 amount, uint64 term) = registrar.price();
        assertEq(amount, 5_000_000);
        assertEq(term, 7 days);
    }

    function test_setPrice_revertsForNonPublisher() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SubscriptionRegistrar.NotPublisher.selector, alice));
        registrar.setPrice(1, 1 days);
    }

    function test_setPrice_rejectsZeroAmountOrTerm() public {
        vm.startPrank(publisher);
        vm.expectRevert(SubscriptionRegistrar.InvalidPrice.selector);
        registrar.setPrice(0, TERM);
        vm.expectRevert(SubscriptionRegistrar.InvalidPrice.selector);
        registrar.setPrice(PRICE, 0);
        vm.stopPrank();
    }

    function test_setPrice_rejectsAbsurdTerm() public {
        vm.prank(publisher);
        vm.expectRevert(abi.encodeWithSelector(SubscriptionRegistrar.TermTooLong.selector, uint64(4000 days)));
        registrar.setPrice(PRICE, 4000 days);
    }

    function test_newPriceAppliesToTheNextSubscription() public {
        vm.prank(publisher);
        registrar.setPrice(1_000_000, 7 days);

        _subscribeAs(alice);

        assertEq(token.balanceOf(publisher), 1_000_000);
        assertEq(registrar.expiryOf(alice), uint64(block.timestamp) + 7 days);
    }

    // --------------------------------------------------------------- token ids

    /// @dev Token IDs in the Permissioned Registry move when roles change. The
    ///      registrar must resolve one fresh on every renewal rather than
    ///      remembering the one it minted (rule 5).
    function test_renewal_resolvesTokenIdFreshAfterRolesChange() public {
        uint256 mintedId = _subscribeAs(alice);

        registry.bumpRolesEpoch();
        uint256 movedId = registry.findTokenId(registrar.labelFor(alice));
        assertTrue(movedId != mintedId, "the token id moved");

        vm.warp(block.timestamp + 1 days);
        _subscribeAs(alice);

        assertTrue(registrar.isActive(alice), "renewal followed the id instead of breaking");
    }

    // ------------------------------------------------------------ construction

    function test_constructor_rejectsInvalidConfiguration() public {
        vm.expectRevert(SubscriptionRegistrar.InvalidPrice.selector);
        new SubscriptionRegistrar(
            IPermissionedRegistry(address(registry)),
            IERC20(address(token)),
            publisher,
            IPermissionedResolver(address(resolver)),
            COLLECTION_NODE,
            0,
            TERM
        );

        vm.expectRevert(SubscriptionRegistrar.InvalidSubscriber.selector);
        new SubscriptionRegistrar(
            IPermissionedRegistry(address(registry)),
            IERC20(address(token)),
            address(0),
            IPermissionedResolver(address(resolver)),
            COLLECTION_NODE,
            PRICE,
            TERM
        );
    }

    function test_subscribe_rejectsZeroSubscriber() public {
        vm.prank(alice);
        vm.expectRevert(SubscriptionRegistrar.InvalidSubscriber.selector);
        registrar.subscribe(address(0));
    }
}
