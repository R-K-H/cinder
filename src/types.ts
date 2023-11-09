import { bignum } from '@metaplex-foundation/beet'
import { Connection } from '@solana/web3.js'


export enum Side {
  sell = 'sell',
  buy = 'buy'
}

export interface Trade {
  price: number
  quantity: number
  side: string
}
  
export interface Order {
  exchangeOrderId?: bignum | null | undefined
  clientOrderId?: number | null | undefined
  price: number
  quantity: number
  side: Side
  expireTs?: number
  expireBlock?: number
}

export interface Balance {
  asset: string
  amount: number
  free: number
  locked: number

 /* //raw number stored
  rawAmount?: number;
  //amount of decimals
  decimals?: number;
  //display name
  name?: string;*/
  
}

export interface MarketRules {
  marketAddress: string
  base: string
  quote: string
  minNotional: number
  minBaseIncrement: number
  minQuoteIncrement: number
  takerFee: number
}

export interface ContractBalance {
  base: Balance;
  quote: Balance;
  trading_pair: string;
  market: string;
}

export interface Ticker {
  type: string;
  sequence: number;
  product_id: string;
  price: string;
  open_24h: string;
  volume_24h: string;
  low_24h: string;
  high_24h: string;
  volume_30d: string;
  best_bid: string;
  best_bid_size: string;
  best_ask: string;
  best_ask_size: string;
  side: Side;
  time: string;
  trade_id: number;
  last_size: string;
}

export interface OrderBook {
  bids: OrderLevel[]
  asks: OrderLevel[]
}

export interface OrderLevel {
  price: number
  quantity: number
}

export interface DataStore {
  isRunning: boolean
  firstRun: boolean
  lastExecuteTime: EpochTimeStamp
  socket: WebSocket
  web3Connection: Connection
  previousMidPrice: number | null
}


export interface TradeData {
  lastPrice: number
  lastMessageRecv: EpochTimeStamp
  orderBook:OrderBook
  tradeHashMap: Map<number, Trade>
}

export interface OrderAmounts {
  asks: Array<number>
  bids: Array<number>
}