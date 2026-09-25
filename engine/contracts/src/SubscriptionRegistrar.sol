// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPermissionedRegistry, IRegistry} from "./interfaces/IPermissionedRegistry.sol";
import {IPermissionedResolver} from "./interfaces/IPermissionedResolver.sol";
import {RecallRoles} from "./RegistryRoles.sol";

/// @title SubscriptionRegistrar
/// @notice Sells expiring subscription subnames of a Recall collection for a stablecoin.
///
/// @dev The ENSv2 `ETHRegistrar` handles paid registration of `.eth` second-level
///      names, but a collection's own subregistry has no payment path. This is that
///      path, and it is the only custom contract in the system — everything else
///      is stock ENSv2.
///
///      A subscription is the name `sub-<subscriber>.<collection>`, held by the
///      subscriber, expiring at `now + term`. Holding a live one is what makes an
///      agent a subscriber; there is no separate subscriber list to fall out of
///      sync with the chain.
///
///      Two roles must be granted to this contract before it can do its job.
///      `deploy-collection.ts` does both:
///        - on the collection subregistry: `ROLE_REGISTRAR | ROLE_RENEW` (root resource)
///        - on the collection resolver:    `ROLE_SET_PUBKEY_ADMIN`       (root resource)
///      The second is what lets it hand each subscriber write access to their own
///      `pubkey` record, which is where the publisher reads the key to wrap the
///      collection content key against.
contract SubscriptionRegistrar {
    using SafeERC20 for IERC20;

    ////////////////////////////////////////////////////////////////////////
    // Errors
    ////////////////////////////////////////////////////////////////////////

    error NotPublisher(address caller);
    error InvalidPrice();
    error InvalidSubscriber();
    error TermTooLong(uint64 term);

    ////////////////////////////////////////////////////////////////////////
    // Events
    ////////////////////////////////////////////////////////////////////////

    /// @notice A subscription was created or extended.
    /// @param subscriber The address that now holds the subscription name.
    /// @param tokenId The subscription's token ID *at the time of this call*.
    ///        Token IDs change when roles change — do not cache this.
    /// @param expiry The new absolute expiry.
    event Subscribed(address indexed subscriber, uint256 indexed tokenId, uint64 expiry);

    /// @notice The price or term changed.
    event PriceChanged(uint256 amount, uint64 term);

    ////////////////////////////////////////////////////////////////////////
    // Immutables
    ////////////////////////////////////////////////////////////////////////

    /// @notice The collection's own subregistry, where subscription names are minted.
    IPermissionedRegistry public immutable registry;

    /// @notice The stablecoin subscriptions are paid in.
    IERC20 public immutable token;

    /// @notice Receives every payment, and the only account that can set the price.
    address public immutable publisher;

    /// @notice The collection's resolver, where subscribers are granted `pubkey` rights.
    IPermissionedResolver public immutable resolver;

    /// @notice Namehash of the collection itself, e.g. namehash("exploits.auditor.eth").
    /// @dev Used to derive each subscription's node without a string round-trip.
    bytes32 public immutable collectionNode;

    /// @dev A term longer than this is almost certainly a units mistake
    ///      (milliseconds for seconds) rather than a real ten-year subscription.
    uint64 internal constant MAX_TERM = 3650 days;

    ////////////////////////////////////////////////////////////////////////
    // Storage
    ////////////////////////////////////////////////////////////////////////

    uint256 private _amount;
    uint64 private _term;

    ////////////////////////////////////////////////////////////////////////
    // Construction
    ////////////////////////////////////////////////////////////////////////

    constructor(
        IPermissionedRegistry registry_,
        IERC20 token_,
        address publisher_,
        IPermissionedResolver resolver_,
        bytes32 collectionNode_,
        uint256 amount_,
        uint64 term_
    ) {
        if (publisher_ == address(0)) revert InvalidSubscriber();
        if (term_ == 0 || amount_ == 0) revert InvalidPrice();
        if (term_ > MAX_TERM) revert TermTooLong(term_);

        registry = registry_;
        token = token_;
        publisher = publisher_;
        resolver = resolver_;
        collectionNode = collectionNode_;
        _amount = amount_;
        _term = term_;

        emit PriceChanged(amount_, term_);
    }

    ////////////////////////////////////////////////////////////////////////
    // Pricing
    ////////////////////////////////////////////////////////////////////////

    /// @notice The current price and term.
    /// @return amount Stablecoin units charged per term.
    /// @return term Length of one subscription term, in seconds.
    function price() external view returns (uint256 amount, uint64 term) {
        return (_amount, _term);
    }

    /// @notice Update the price. Publisher only.
    function setPrice(uint256 amount, uint64 term) external {
        if (msg.sender != publisher) revert NotPublisher(msg.sender);
        if (term == 0 || amount == 0) revert InvalidPrice();
        if (term > MAX_TERM) revert TermTooLong(term);
        _amount = amount;
        _term = term;
        emit PriceChanged(amount, term);
    }

    ////////////////////////////////////////////////////////////////////////
    // Subscribing
    ////////////////////////////////////////////////////////////////////////

    /// @notice Buy or extend a subscription for `subscriber`.
    ///
    /// @dev `msg.sender` pays; `subscriber` receives the name. Separating them
    ///      lets a console pay on behalf of an agent's own address.
    ///
    ///      Renewing an active subscription extends from its **current expiry**,
    ///      not from now. Extending from now would silently confiscate the unused
    ///      remainder of the term the subscriber already paid for.
    ///
    /// @param subscriber The address that will hold the subscription.
    /// @return tokenId The subscription token ID as of this call.
    function subscribe(address subscriber) external returns (uint256 tokenId) {
        if (subscriber == address(0)) revert InvalidSubscriber();

        string memory label = labelFor(subscriber);
        uint64 currentExpiry = registry.findExpiry(label);
        bool active = currentExpiry > block.timestamp;

        // Extend from whichever is later: an unexpired term, or now.
        uint64 newExpiry = (active ? currentExpiry : uint64(block.timestamp)) + _term;

        // Pull and forward in one move. Reverts on insufficient allowance or
        // balance, before any name is minted.
        token.safeTransferFrom(msg.sender, publisher, _amount);

        if (active) {
            // The name already exists and is held by `subscriber`; just extend it.
            tokenId = registry.findTokenId(label);
            registry.renew(tokenId, newExpiry);
        } else {
            // Fresh registration. The subscriber gets no registry roles: they own
            // the token, but must not be able to repoint the name's resolver or
            // subregistry.
            tokenId = registry.register(
                label,
                subscriber,
                IRegistry(address(0)),
                address(resolver),
                0,
                newExpiry
            );

            // Let the subscriber write `pubkey` on their own subscription name
            // and nothing else. `setPubkey` checks `resource(node, 0)`, so that
            // is the resource the role is granted on.
            resolver.grantRoles(
                _pubkeyResource(subscriber),
                RecallRoles.ROLE_SET_PUBKEY,
                subscriber
            );
        }

        emit Subscribed(subscriber, tokenId, newExpiry);
    }

    ////////////////////////////////////////////////////////////////////////
    // Views
    ////////////////////////////////////////////////////////////////////////

    /// @notice Whether `subscriber` holds a live subscription.
    /// @dev This is the whole access check. A lapsed subscription needs no
    ///      revocation transaction — it simply stops being true.
    function isActive(address subscriber) external view returns (bool) {
        return registry.findExpiry(labelFor(subscriber)) > block.timestamp;
    }

    /// @notice Absolute expiry of `subscriber`'s subscription. Zero if never bought.
    function expiryOf(address subscriber) external view returns (uint64) {
        return registry.findExpiry(labelFor(subscriber));
    }

    /// @notice The subscription label for an address, e.g. `sub-0xab..cd`.
    function labelFor(address subscriber) public pure returns (string memory) {
        return string.concat("sub-", _toHexString(subscriber));
    }

    /// @notice Namehash of `subscriber`'s subscription name.
    function nodeFor(address subscriber) public view returns (bytes32) {
        return keccak256(abi.encodePacked(collectionNode, keccak256(bytes(labelFor(subscriber)))));
    }

    ////////////////////////////////////////////////////////////////////////
    // Internal
    ////////////////////////////////////////////////////////////////////////

    /// @dev The EAC resource `setPubkey` checks: `resource(node, 0)`.
    function _pubkeyResource(address subscriber) internal view returns (uint256) {
        return uint256(keccak256(abi.encode(nodeFor(subscriber), bytes32(0))));
    }

    /// @dev Lowercase `0x`-prefixed hex, matching how the label is derived off chain.
    function _toHexString(address value) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory out = new bytes(42);
        out[0] = "0";
        out[1] = "x";
        uint160 v = uint160(value);
        for (uint256 i = 41; i > 1; --i) {
            out[i] = alphabet[v & 0xf];
            v >>= 4;
        }
        return string(out);
    }
}
