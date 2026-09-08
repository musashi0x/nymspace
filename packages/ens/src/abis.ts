/**
 * Pinned ABI fragments for the ENSv2 contracts this product touches.
 *
 * ENSv2 is in beta and its interfaces churn — docs/17_RISKS_AND_FALLBACKS.md
 * Risk 1. Pinning the fragments here means a churn event changes one file
 * rather than every call site, which is the entire reason this package exists.
 *
 * The fragments below are the shapes docs/05_ENSV2_IMPLEMENTATION.md documents.
 * The Day 1 spike verifies each one against the deployed Sepolia contracts and
 * corrects anything the beta has moved.
 */

export const permissionedResolverAbi = [
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "authorizeTextRoles",
    stateMutability: "nonpayable",
    inputs: [
      { name: "dnsName", type: "bytes" },
      { name: "key", type: "string" },
      { name: "account", type: "address" },
      { name: "authorized", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "hasRoles",
    stateMutability: "view",
    inputs: [
      { name: "resource", type: "bytes32" },
      { name: "roleBitmap", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "roles",
    stateMutability: "view",
    inputs: [
      { name: "resource", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const registryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      { name: "label", type: "string" },
      { name: "owner", type: "address" },
      { name: "subregistry", type: "address" },
      { name: "resolver", type: "address" },
      { name: "roleBitmap", type: "uint256" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setResolver",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "resolver", type: "address" },
    ],
    outputs: [],
  },
] as const;
