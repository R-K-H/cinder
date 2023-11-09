
import {
  OpenBookV2Client,
  findAllMarkets
} from '@openbook-dex/openbook-v2'
import {
  Connection,
  Keypair,
  PublicKey
} from '@solana/web3.js'
import BN from 'bn.js'
import { ILogObj, Logger } from 'tslog'

import { AnchorProvider, Wallet } from '@coral-xyz/anchor'
import * as dotenv from 'dotenv'
dotenv.config()


const S_NUM_0 = new BN(0)

// TODO: need to map this or find out where to calculate it somehow..
const MARKET_TICK_SIZE = 0.005
const log: Logger<ILogObj> = new Logger()

export const programId = new PublicKey(
  'opnbkNkqux64GppQhwbyEVc3axhssFhVYuwar8rDHCu'
)

export default class OpenBookConnector{
  client: OpenBookV2Client
  web3Connection: Connection
  markets: string[]
  trader: Keypair
  airDrop: boolean
  provider: any
  
  constructor(trader: Keypair, markets: string[], web3Connection: Connection, airDrop: boolean) {
    this.web3Connection = web3Connection
    this.markets = markets
    this.airDrop = airDrop
    this.trader = trader
  }

  async connect() {
    const wallet = new Wallet(this.trader)
    const provider = new AnchorProvider(this.web3Connection, wallet, {
      commitment: 'finalized',
    })
    this.provider = provider
    log.info(provider)
  }

  async getMarkets() {
    let markets = await findAllMarkets(this.web3Connection, programId, this.provider)

    log.info(markets)
    return true
  }
}
