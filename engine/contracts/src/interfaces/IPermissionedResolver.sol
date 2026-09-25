// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice The subset of ENSv2's `PermissionedResolver` the registrar needs.
/// @dev Transcribed from the vendored ABI in
///      `packages/core/abis/PermissionedResolverImpl.json` (rule 1).
interface IPermissionedResolver {
    /// @notice Grant EAC roles on a resource.
    /// @dev The caller must hold the admin counterpart of every role granted,
    ///      either on `resource` or on the root resource.
    function grantRoles(uint256 resource, uint256 roleBitmap, address account)
        external
        returns (bool);

    /// @notice Revoke EAC roles on a resource.
    function revokeRoles(uint256 resource, uint256 roleBitmap, address account)
        external
        returns (bool);

    /// @notice Whether `account` holds every role in `roleBitmap` on `resource`
    ///         or on the root resource.
    function hasRoles(uint256 resource, uint256 roleBitmap, address account)
        external
        view
        returns (bool);

    /// @notice Set the secp256k1 public key for a node.
    function setPubkey(bytes32 node, bytes32 x, bytes32 y) external;

    /// @notice Set the contenthash for a node.
    function setContenthash(bytes32 node, bytes calldata hash) external;

    /// @notice Set an arbitrary data record for a node.
    function setData(bytes32 node, string calldata key, bytes calldata value) external;

    /// @notice Read a data record.
    function data(bytes32 node, string calldata key) external view returns (bytes memory);

    /// @notice Grant or revoke `ROLE_SET_DATA` scoped to one data key on one name.
    /// @param toName The DNS-encoded name.
    function authorizeDataRoles(bytes calldata toName, string calldata key, address account, bool grant)
        external
        returns (bool);
}
