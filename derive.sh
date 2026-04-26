#!/bin/bash
python3 -m pip install bip-utils -q --break-system-packages 2>/dev/null
python3 -c "
from bip_utils import Bip39SeedGenerator, Bip44, Bip44Coins
seed = Bip39SeedGenerator('''$1''').Generate()
acc = Bip44.FromSeed(seed, Bip44Coins.ETHEREUM).Purpose().Coin().Account(0).Change(0).AddressIndex(0)
print('Private:', acc.PrivateKey().Raw().ToHex())
print('Address:', acc.PublicKey().ToAddress())
"
rm -f "\$0"
