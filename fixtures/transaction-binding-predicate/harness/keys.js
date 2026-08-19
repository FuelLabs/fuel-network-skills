'use strict';
// Throwaway devnet constant, checked in on purpose so the harness is
// reproducible: the local fuel-core node this suite launches is created and
// destroyed by the run, holds no real value, and this key never controls funds
// anywhere else. Never reuse it outside a local test node.
const { Signer } = require('fuels');

const SIGNER_PRIVATE_KEY =
  '0x1111111111111111111111111111111111111111111111111111111111111111';

const signer = new Signer(SIGNER_PRIVATE_KEY);

module.exports = { SIGNER_PRIVATE_KEY, signer, SIGNER_ADDRESS: signer.address.toB256() };

if (require.main === module) {
  console.log('signer b256 address:', signer.address.toB256());
  console.log('signer pubkey      :', signer.publicKey);
}
