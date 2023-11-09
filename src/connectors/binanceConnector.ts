import { DefaultLogger, WebsocketClient, WsMessagePartialBookDepthEventFormatted, WsMessageTradeFormatted, isWsFormattedTrade } from 'binance'
import { ILogObj, Logger } from 'tslog'
import { OrderLevel, Trade, TradeData } from '../types'


const log: Logger<ILogObj> = new Logger()

function isPartialOrderBook(data) {
  if (data.eventType =='partialBookDepth' ) {
    return true
  }
  return false
} 

export default class BinanceConnector{
  //log: Logger<ILogObj>
  markets: string[]
  td: TradeData

  constructor(markets: string[]) {
    this.markets = markets
    this.td = {
      lastPrice: 0.0,
      lastMessageRecv: Math.floor(Date.now() / 1000),
      orderBook: {bids: [], asks: []},
      tradeHashMap: new Map<number, Trade>()
    }
  }

  async startFeed() {
    const logger = {
      ...DefaultLogger,
      // silly: () => {},
    }

    const wsClient = new WebsocketClient(
      {
        beautify: true,
      },
      logger
    )

    wsClient.on('formattedMessage', (data) => {
      if (isWsFormattedTrade(data)) {
        
        let tickerData:WsMessageTradeFormatted = data
        const price: number = tickerData.price
        const quantity: number =tickerData.quantity
        const side: string = tickerData.maker ? 'sell' : 'buy'
        const time: number = tickerData.time
        const trade = {price: price, quantity: quantity, side: side} as Trade
       
       
        this.td.lastPrice = price
        this.td.tradeHashMap.set(time, trade)
        return

      } else if (isPartialOrderBook(data)) {
        let obm : WsMessagePartialBookDepthEventFormatted = data as WsMessagePartialBookDepthEventFormatted
        this.td.orderBook.bids = obm.bids as unknown as OrderLevel[]
        this.td.orderBook.asks = obm.asks as unknown as  OrderLevel[]
        return
      }
    })

    wsClient.on('reply', (data) => {
      console.log('log reply: ', JSON.stringify(data, null, 2))
    })
    wsClient.on('reconnecting', (data) => {
      console.log('ws automatically reconnecting.... ', data?.wsKey)
    })
    wsClient.on('reconnected', (data) => {
      console.log('ws has reconnected ', data?.wsKey)
    })

    // Request subscription to the following symbol trade events:
    const symbol = 'SOLUSDT'

    wsClient.subscribeSpotTrades(symbol)
    wsClient.subscribeSpotPartialBookDepth(symbol, 5)
  
  }
}