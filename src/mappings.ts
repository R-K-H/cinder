import {
  PublicKey
} from '@solana/web3.js'
import * as dotenv from 'dotenv'
dotenv.config()

export const LOOKBACK_INTERVAL: number = parseInt(process.env.LOOKBACK_INTERVAL as string)
export const STRATEGY_TICK: number = parseInt(process.env.STRATEGY_TICK as string)

export const MODE: string = process.env.OPERATION_MODE as string

export const DOMAINS = {
  'mainnet': 'https://rpc.helius.xyz/',
  'devnet': 'https://rpc-devnet.helius.xyz/'
}

export const TRADING_PAIR = process.env.TRADING_PAIR

export const REQUIRE_AIRDROP: boolean = (process.env.AIRDROP?.toString() == 'true') ? true : false

export const MARKETS = {
  'mainnet': {
    'SOL/USDC': '4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg',
    'mSOL/SOL': 'FZRgpfpvicJ3p23DfmZuvUgcQZBHJsWScTf2N2jK8dy6'
  },
  'devnet': {
    'SOL/USDC': 'CS2H8nbAVVEUHWPF5extCSymqheQdkd4d7thik6eet9N',
    'mSOL/SOL': '626t4FAUCVWMSvZsjzyPDJjPAKvdrafJB2pAcC6Ags2m'
  }
}

export const DATA_FEEDS = {
  'coinbase': 'wss://ws-feed.exchange.coinbase.com',
  'binance': '',
  'kraken': '',
  'kucoin': ''
}

export const DEFAULT_EXPLORER = process.env.EXPLORER as string

export const EXPLORERS = {
  'mainnet': {
    'solscan': 'https://solscan.io/tx/{}',
    'solanabeach': 'https://solanabeach.io/transaction/{}',
    'solanafm': 'https://solana.fm/tx/{}?cluster=mainnet-qn1',
    'solanaexplorer': 'https://explorer.solana.com/tx/{}',
    'xray': 'https://xray.helius.xyz/tx/{}',
  },
  'devnet': {
    'solscan': 'https://solscan.io/tx/{}&cluster=devnet',
    'solanabeach': 'https://solanabeach.io/transaction/{}?cluster=devnet',
    'solanafm': 'https://solana.fm/tx/{}?cluster=devnet-solana',
    'solanaexplorer': 'https://explorer.solana.com/tx/{}?cluster=devnet',
    'xray': 'https://xray.helius.xyz/tx/{}?cluster=devnet'
  }
}

export const getMarketAddress = (market: string): PublicKey => {
  // TODO: add in check for market
  return new PublicKey(MARKETS[process.env.OPERATION_MODE as string][market])
}

export const rpcUrl = (): string => {
  return `${DOMAINS[process.env.OPERATION_MODE as string]}?api-key=${process.env.HELIUS_API_KEY}`
}

export const wsRpcUrl = (): string => {
  return `${DOMAINS[process.env.OPERATION_MODE as string]}?api-key=${process.env.HELIUS_API_KEY}`.replace('https', 'wss') as string
}

export const buildExplorerLink = (txId: string, explorer: string = DEFAULT_EXPLORER): string => {
  // TODO: add in check for explorer
  return `${EXPLORERS[process.env.OPERATION_MODE as string][explorer]}`.replace('{}', txId)
}
