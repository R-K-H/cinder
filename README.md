# ts-market-maker

## Setup
1. Create Solana wallet (you're going to need to export PK, so just dummy or new one).

- https://phantom.app/
- https://solflare.com/
- https://www.backpack.app/
- https://glow.app/


- Can use the CLI

```bash
solana-keygen new
```

2. Download / install Solana CLI

https://docs.solana.com/cli/install-solana-cli-tools

3. Set CLI config to `devnet`

```bash
solana config set --url http://api.devnet.solana.com
```

4. Set CLI to use your keypair

```bash
solana config set --keypair {}
```

5. Airdrop Devnet SOL to yourself

```bash
solana airdrop 1
```

6. Check your balance

```bash
solana balance
```

7. Setup a Helius RPC account (free) by connecting your wallet in the dev portal
https://www.helius.dev/

8. Copy the example.env to .env and add in your API key

9. Set the `REQUIRE_AIRDROP` to true in `index.ts`

10. Install dependencies `yarn install`

11. Create a `pk.ts` file in the `src/.pk/` folder and include the following with your private key:

```javascript
const pk: number[] = []
export default pk
```

12. `yarn start`

13. Once you have an airdrop completed, you'll have 1 SOL and 1000 USDC (unknown tokens, generated for Phoenix). You'll want to hit the UI place a buy order for SOL out of your USDC you can trade.

14. Happy running