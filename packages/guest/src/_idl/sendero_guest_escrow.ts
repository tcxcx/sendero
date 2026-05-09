/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/sendero_guest_escrow.json`.
 */
export type SenderoGuestEscrow = {
  address: '9NHw47GifDKsPDggQeQd53sNrAsBWeSayzvvSr2tjUL8';
  metadata: {
    name: 'senderoGuestEscrow';
    version: '0.1.0';
    spec: '0.1.0';
    description: 'Solana port of SenderoGuestEscrow.sol — pre-funded guest-link travel escrow';
  };
  instructions: [
    {
      name: 'claimTrip';
      docs: ['Guest claims the trip with a recipient-bound signature + OTP digest.'];
      discriminator: [9, 140, 211, 39, 76, 254, 135, 200];
      accounts: [
        {
          name: 'relayer';
          docs: [
            'Sendero relayer pays rent + sends the tx. The actual',
            'authorization comes from the Ed25519 sibling instruction.',
          ];
          writable: true;
          signer: true;
        },
        {
          name: 'instructionsSysvar';
        },
      ];
      args: [
        {
          name: 'tripId';
          type: {
            array: ['u8', 32];
          };
        },
        {
          name: 'otpHash';
          type: {
            array: ['u8', 32];
          };
        },
        {
          name: 'recipientSignature';
          type: 'bytes';
        },
      ];
    },
    {
      name: 'commitBooking';
      docs: ['Operator commits at the actual quoted price ≤ upper_bound.'];
      discriminator: [138, 181, 37, 155, 46, 218, 54, 155];
      accounts: [
        {
          name: 'operator';
          writable: true;
          signer: true;
        },
      ];
      args: [
        {
          name: 'bookingId';
          type: {
            array: ['u8', 32];
          };
        },
        {
          name: 'quotedPrice';
          type: 'u64';
        },
      ];
    },
    {
      name: 'initialize';
      discriminator: [175, 175, 109, 31, 13, 152, 155, 237];
      accounts: [
        {
          name: 'admin';
          writable: true;
          signer: true;
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        },
      ];
      args: [
        {
          name: 'operator';
          type: 'pubkey';
        },
      ];
    },
    {
      name: 'preFundTrip';
      docs: ['Buyer pre-funds a trip for a named guest. Trip starts in PreFunded.'];
      discriminator: [30, 248, 158, 27, 52, 173, 114, 82];
      accounts: [
        {
          name: 'buyer';
          writable: true;
          signer: true;
        },
      ];
      args: [
        {
          name: 'tripId';
          type: {
            array: ['u8', 32];
          };
        },
        {
          name: 'amount';
          type: 'u64';
        },
        {
          name: 'claimPubkey';
          type: 'pubkey';
        },
        {
          name: 'expiry';
          type: 'i64';
        },
      ];
    },
    {
      name: 'refundBooking';
      docs: [
        'Buyer or operator refunds. Conditions per Solidity:',
        '- RESERVED + > 1h since reservation → buyer can force-refund',
        '- COMMITTED + > 30min since commit → buyer can force-refund',
      ];
      discriminator: [160, 80, 31, 89, 219, 78, 233, 67];
      accounts: [
        {
          name: 'caller';
          writable: true;
          signer: true;
        },
      ];
      args: [
        {
          name: 'bookingId';
          type: {
            array: ['u8', 32];
          };
        },
      ];
    },
    {
      name: 'reserveBooking';
      docs: ['Operator reserves an upper-bound amount on a booking before', 'quoting Duffel.'];
      discriminator: [170, 28, 99, 26, 95, 11, 225, 109];
      accounts: [
        {
          name: 'operator';
          writable: true;
          signer: true;
        },
      ];
      args: [
        {
          name: 'tripId';
          type: {
            array: ['u8', 32];
          };
        },
        {
          name: 'bookingId';
          type: {
            array: ['u8', 32];
          };
        },
        {
          name: 'upperBound';
          type: 'u64';
        },
      ];
    },
    {
      name: 'settleBooking';
      docs: ['Operator settles to vendor payout address after Duffel', 'confirmation lands.'];
      discriminator: [118, 241, 41, 192, 52, 160, 213, 100];
      accounts: [
        {
          name: 'operator';
          writable: true;
          signer: true;
        },
      ];
      args: [
        {
          name: 'bookingId';
          type: {
            array: ['u8', 32];
          };
        },
        {
          name: 'duffelOrderRef';
          type: {
            array: ['u8', 32];
          };
        },
      ];
    },
    {
      name: 'sweepTripResidual';
      discriminator: [179, 35, 198, 77, 31, 206, 190, 39];
      accounts: [
        {
          name: 'caller';
          writable: true;
          signer: true;
        },
      ];
      args: [
        {
          name: 'tripId';
          type: {
            array: ['u8', 32];
          };
        },
      ];
    },
  ];
  errors: [
    {
      code: 6000;
      name: 'invalidTrip';
      msg: 'Trip does not exist';
    },
    {
      code: 6001;
      name: 'invalidBooking';
      msg: 'Booking does not exist';
    },
    {
      code: 6002;
      name: 'wrongStatus';
      msg: 'Trip/Booking is not in the required state for this action';
    },
    {
      code: 6003;
      name: 'unauthorized';
      msg: 'Caller is not authorized';
    },
    {
      code: 6004;
      name: 'expired';
      msg: 'Trip has expired';
    },
    {
      code: 6005;
      name: 'invalidClaimSignature';
      msg: 'Claim signature did not verify against the embedded pubkey';
    },
    {
      code: 6006;
      name: 'invalidOtp';
      msg: 'OTP hash did not match';
    },
    {
      code: 6007;
      name: 'quoteExceedsBound';
      msg: 'Quoted price exceeds upper bound';
    },
    {
      code: 6008;
      name: 'insufficientFunds';
      msg: 'Insufficient escrow balance';
    },
  ];
};
