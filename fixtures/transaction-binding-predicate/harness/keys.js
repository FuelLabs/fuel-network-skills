'use strict';
// Throwaway devnet constants, checked in on purpose so the harness is
// reproducible: the local fuel-core node this suite launches is created and
// destroyed by the run, holds no real value, and these keys never control funds
// anywhere else. Never reuse them outside a local test node.
//
//  - SIGNER   is the order signer whose address replaces the documented
//             `SIGNER` placeholder in the built predicate.
//  - ATTACKER is the hostile transaction assembler used by the negative cases
//             that need a second, non-predicate input of their own.
const { Signer } = require('fuels');

const SIGNER_PRIVATE_KEY =
  '0x1111111111111111111111111111111111111111111111111111111111111111';
const ATTACKER_PRIVATE_KEY =
  '0x3333333333333333333333333333333333333333333333333333333333333333';

const signer = new Signer(SIGNER_PRIVATE_KEY);
const attacker = new Signer(ATTACKER_PRIVATE_KEY);

module.exports = {
  SIGNER_PRIVATE_KEY,
  signer,
  SIGNER_ADDRESS: signer.address.toB256(),
  ATTACKER_PRIVATE_KEY,
  attacker,
  ATTACKER_ADDRESS: attacker.address.toB256(),
};

if (require.main === module) {
  console.log('signer b256 address  :', signer.address.toB256());
  console.log('signer pubkey        :', signer.publicKey);
  console.log('attacker b256 address:', attacker.address.toB256());
}
