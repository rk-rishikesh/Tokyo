// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {IPermissionedRegistry, IRegistry} from "../../src/interfaces/IPermissionedRegistry.sol";

/// @notice Minimal ERC20 with the allowance semantics the registrar depends on.
contract MockERC20 is IERC20 {
    string public name = "Mock USDC";
    string public symbol = "USDC";
    uint8 public decimals = 6;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "ERC20: insufficient allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "ERC20: insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

/// @notice Registry mock modelling the parts of `PermissionedRegistry` the
///         registrar touches: expiry tracking, token IDs that move when roles
///         change, and refusal to reduce an expiry.
contract MockRegistry is IPermissionedRegistry {
    error LabelAlreadyRegistered(string label);
    error CannotReduceExpiry(uint64 oldExpiry, uint64 newExpiry);
    error NotRegistrar(address caller);

    struct Record {
        address owner;
        uint64 expiry;
        address resolver;
        uint256 roleBitmap;
        bool exists;
    }

    mapping(string => Record) internal records;
    mapping(address => bool) public isRegistrar;

    /// @dev Every label ever registered. The real registry resolves `anyId` —
    ///      labelhash, token ID, or resource — back to the name internally, so
    ///      the mock has to resolve a *current* token ID too, not just the one
    ///      that happened to be minted.
    string[] internal knownLabels;

    /// @dev Bumped whenever roles change, so token IDs move exactly the way the
    ///      real registry's do. Anything that caches a token ID breaks here.
    uint256 public rolesEpoch;

    function setRegistrar(address who, bool allowed) external {
        isRegistrar[who] = allowed;
    }

    function bumpRolesEpoch() external {
        rolesEpoch++;
    }

    function register(
        string calldata label,
        address owner,
        IRegistry,
        address resolver,
        uint256 roleBitmap,
        uint64 expiry
    ) external returns (uint256 tokenId) {
        if (!isRegistrar[msg.sender]) revert NotRegistrar(msg.sender);
        Record storage r = records[label];
        if (r.exists && r.expiry > block.timestamp) revert LabelAlreadyRegistered(label);

        r.owner = owner;
        r.expiry = expiry;
        r.resolver = resolver;
        r.roleBitmap = roleBitmap;
        r.exists = true;

        tokenId = _tokenId(label);
        knownLabels.push(label);
    }

    function renew(uint256 anyId, uint64 newExpiry) external {
        if (!isRegistrar[msg.sender]) revert NotRegistrar(msg.sender);
        string memory label = _labelOf(anyId);
        Record storage r = records[label];
        if (newExpiry < r.expiry) revert CannotReduceExpiry(r.expiry, newExpiry);
        r.expiry = newExpiry;
    }

    function findExpiry(string calldata label) external view returns (uint64) {
        return records[label].expiry;
    }

    function findTokenId(string calldata label) external view returns (uint256) {
        return _tokenId(label);
    }

    function getResource(uint256 anyId) external pure returns (uint256) {
        return anyId;
    }

    function grantRoles(uint256, uint256, address) external returns (bool) {
        rolesEpoch++;
        return true;
    }

    function getSubregistry(string calldata) external pure returns (IRegistry) {
        return IRegistry(address(0));
    }

    function getResolver(string calldata label) external view returns (address) {
        return records[label].resolver;
    }

    function ownerOf(string calldata label) external view returns (address) {
        return records[label].owner;
    }

    function roleBitmapOf(string calldata label) external view returns (uint256) {
        return records[label].roleBitmap;
    }

    function _tokenId(string memory label) internal view returns (uint256) {
        return uint256(keccak256(abi.encodePacked(label, rolesEpoch)));
    }

    /// @dev Resolve a current token ID back to its label.
    function _labelOf(uint256 anyId) internal view returns (string memory) {
        for (uint256 i; i < knownLabels.length; ++i) {
            if (_tokenId(knownLabels[i]) == anyId) return knownLabels[i];
        }
        revert("unknown token");
    }
}

/// @notice Resolver mock that records grants so tests can assert exactly which
///         resource a subscriber was authorised on.
contract MockResolver {
    struct Grant {
        uint256 resource;
        uint256 roleBitmap;
        address account;
    }

    Grant[] public grants;
    mapping(uint256 => mapping(address => uint256)) public rolesOf;

    function grantRoles(uint256 resource, uint256 roleBitmap, address account)
        external
        returns (bool)
    {
        grants.push(Grant(resource, roleBitmap, account));
        rolesOf[resource][account] |= roleBitmap;
        return true;
    }

    function grantCount() external view returns (uint256) {
        return grants.length;
    }

    function hasRoles(uint256 resource, uint256 roleBitmap, address account)
        external
        view
        returns (bool)
    {
        return rolesOf[resource][account] & roleBitmap == roleBitmap;
    }
}
