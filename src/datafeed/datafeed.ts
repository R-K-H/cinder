import { ILogObj, Logger } from 'tslog'
import BinanceConnector from '../connectors/binanceConnector'
import CoinbaseConnector from '../connectors/coinbaseConnector'
import PhoenixConnector from '../connectors/phoenixConnector'
import { DataStore, Trade } from '../types'


export enum Source {
  binance = 'b',
  coinbase = 'c',
  phoenix = 'p',
  openbook = 'o'
}


export default class Datafeed{
  cb: CoinbaseConnector
  log: Logger<ILogObj>
  ds: DataStore
  phoenix: PhoenixConnector
  binance: BinanceConnector
  openBook?: null | undefined


  constructor(datastore: DataStore, log: Logger<ILogObj>, markets: string[]) {
    this.cb = new CoinbaseConnector(markets)
    this.binance = new BinanceConnector(markets)
    this.phoenix = new PhoenixConnector(datastore.web3Connection, markets)
    this.log = log
    this.ds = datastore
  }

  //starts the websocket feeds for all of our data sources
  async startFeed() {
    //this.binance.startFeed()
    this.cb.startFeed()
    this.phoenix.startFeed()
  }
 
  //gets the order books for a specific source
  getOrderBook(s:Source) {
    switch (s) {
    case Source.binance:
      return this.binance.td.orderBook
      break
      
    case Source.coinbase: 
      return this.cb.td.orderBook
      break
 
    case Source.phoenix:
      return this.phoenix.td.orderBook
      break
    }
    return {bids: [], asks: []} 
  }

  //gets the trades for a specific source
  getTrades(s:Source) {
    switch (s) {
    case Source.binance:
      return this.binance.td.tradeHashMap
      break
      
    case Source.coinbase: 
      return this.cb.td.tradeHashMap
      break  
    
    case Source.phoenix:
      return this.phoenix.td.tradeHashMap
      break
    }
    return new Map<number, Trade>
  }

  //checks if there is orderbook data for a specific source
  hasData(s:Source) {
    switch (s) {
    case Source.binance:
      return this.binance.td.orderBook.bids.length > 0 && this.binance.td.orderBook.asks.length > 0
      break
    
    case Source.coinbase: 
      return this.cb.td.orderBook.bids.length > 0 && this.cb.td.orderBook.asks.length > 0
      break
    
    case Source.phoenix:
      return this.phoenix.td.orderBook.bids.length > 0 && this.phoenix.td.orderBook.asks.length > 0
    }
    return false    
  }

  //really should be removed.
  async reconnect(){
    await this.cb.wsReconnectLogic()
  }
}