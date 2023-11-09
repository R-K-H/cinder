import * as crypto from 'crypto'
import * as dotenv from 'dotenv'
import fetch from 'node-fetch'
import { ILogObj, Logger } from 'tslog'
import WebSocket from 'ws'
import { Order, Ticker, Trade, TradeData } from '../types'
dotenv.config()

const log: Logger<ILogObj> = new Logger()

// Work around for fetch
// @ts-ignore
globalThis.fetch = fetch

//{"type":"ticker","sequence":8724728330,"product_id":"SOL-USD","price":"16.38","open_24h":"16.69","volume_24h":"1106258.27600000","low_24h":"15.9","high_24h":"16.94","volume_30d":"30626740.42600000","best_bid":"16.380","best_bid_size":"91.658","best_ask":"16.390","best_ask_size":"2068.511","side":"sell","time":"2023-06-28T16:12:45.830539Z","trade_id":88182111,"last_size":"213.479"}


const IDLE_CONNECTION_TIMEOUT: number = 2

export default class CoinbaseConnector{
  socket: WebSocket | null
  //lastMessageRecv: number
  //orderBook: OrderBook
  markets: string[]
  td: TradeData

  constructor(markets: string[]){
    this.socket = null
    this.markets = markets
    this.td = {
      lastPrice: 0.0,
      lastMessageRecv: Math.floor(Date.now() / 1000),
      orderBook: {bids: [], asks: []},
      tradeHashMap: new Map<number, Trade>()
    }
  }

  wsReconnectLogic = async () => {
    // @ts-ignore
    if([WebSocket.CLOSED, WebSocket.CLOSING].includes(this.socket?.readyState)){
      log.error('Websocket disconnected / closed')
      try{
        await this.wsConnect()
      }catch(error){
        log.error(`Error: ${error}`)
      }
    }
    const currentTimestamp = Math.floor(Date.now() / 1000)

    const timeOutExpired: boolean = this.td.lastMessageRecv < (currentTimestamp - IDLE_CONNECTION_TIMEOUT)
    
    if((WebSocket.OPEN === this.socket?.readyState) && timeOutExpired){
      log.error('Websocket timeout')
      try {
        await this.wsConnect()
      } catch(error) {
        log.error(`Error: ${error}`)
      }
    }
  }

  wsConnect = async() => {
    try {
      log.info('Connecting to WS Data Feed')
      const socket = new WebSocket('wss://ws-feed.exchange.coinbase.com')
      // TODO: Place this above everything else..
      if(socket) {
        socket.onopen = async() => {
          await this.connectAll(socket)
        }
        this.socket = socket
      }
    } catch (error) {
      log.error(`Error: ${error}`)
    }
  }
  subscribeMarketChannels = async(socket) => {
    socket.send(JSON.stringify({
      'type': 'subscribe',
      'product_ids': [
        'SOL-USD',
      ],
      'channels': ['ticker']
    }))
  }
      
  subscribeHeartbeat = async(socket) => {
    socket.send(JSON.stringify({
      'type': 'subscribe',
      'channels': [
        {
          'name': 'heartbeat',
          'product_ids': [
            'SOL-USD'
          ]
        }
      ]
    }))
  }
      
  // @ts-nocheck
  subscribeL2 = async(socket) => {
    const secret = process.env.COINBASE_SECRET as string
    const key = process.env.COINBASE_API_KEY as string
    const passphrase = process.env.COINBASE_PASSWORD as string
    const timestamp = Date.now() / 1000 // in ms
    const signature = this.encodeMessageRequest(secret, timestamp)
    socket.send(JSON.stringify({
      'type': 'subscribe',
      'channels': ['level2'],
      'product_ids': [
        'SOL-USD'
      ],
      'signature': signature,
      'key': key,
      'passphrase': passphrase,
      'timestamp': timestamp
    }))
  }

  connectAll = async(socket) => {
    // @ts-ignore
    log.info('Websocket Connection established, subscribing channels')
    await this.subscribeMarketChannels(socket)
    await this.subscribeHeartbeat(socket)
    await this.subscribeL2(socket)
  }

  async startFeed() {
    // Setup our market data connection NOTE: We need to do this as close to these messages, so not to lose any
    await this.wsConnect()
    // Listen for messages
    // @ts-ignore
    this.socket.onmessage = async(event) => {
      
      const eventMessage = JSON.parse(event.data.toString())
      
      if('type' in eventMessage && eventMessage.type == 'l2update'){
        return
      }

      // Subscription message
      if('type' in eventMessage && eventMessage.type == 'subscriptions'){
        if(eventMessage.channels.length === 3){
          log.info('Subscribed to all update channels')
        }
        return
      }

      // Heartbeat message
      if('type' in eventMessage &&  eventMessage.type == 'heartbeat'){
        this.td.lastMessageRecv = Math.floor(new Date(eventMessage.time).getTime() / 1000)
        return
      }

      // Snapshot message
      if('type' in eventMessage && eventMessage.type == 'snapshot'){
        this.td.orderBook.bids = eventMessage.bids.map((x) => {
          return [+x[0], +x[1] ]
        })
        this.td.orderBook.asks = eventMessage.asks.map((x) => {
          return [+x[0], +x[1] ]
        })


        //console.log(dataStore.orderBook)
        // for(const order in eventMessage.bids){
        //   const orderData = {price: Number(order[0]), quantity: Number(order[1]), side: "buy"} as Order
        //   // TODO: Update the price key with the quantity...
        //   // @ts-ignore
        //   //orderRingBuffer.push(orderData)
        // }
        // for(const order in eventMessage.asks){
        //   const orderData = {price: Number(order[0]), quantity: Number(order[1]), side: "sell"} as Order
        //   // TODO: Update the price key with the quantity...
        //   // @ts-ignore
        //   //orderRingBuffer.push(orderData)
        // }
      }

      

      // Update message
      if('type' in eventMessage && eventMessage.type == 'l2update'){
        for(const delta in eventMessage.changes) {
          const orderData = {price: Number(delta[1]), quantity: Number(delta[2]), side: delta[0]} as Order
          // TODO: We need to check for NEW orders being placed..
          // @ts-ignore
          // orderRingBuffer.push(orderData)
        }
      }

      // Ticker message
      if('type' in eventMessage &&  eventMessage.type == 'ticker'){
        // TODO: We can replace this with the L2 update I think is the better way to do this...
        
        const tickerData = eventMessage as Ticker
        
        const price: number = Number(tickerData.price)
        const quantity: number = Number(tickerData.last_size)
        const side: string = tickerData.side
        const time: number = Date.parse(tickerData.time)
        const trade = {price: price, quantity: quantity, side: side} as Trade
       
       
        this.td.lastPrice = price
        this.td.tradeHashMap.set(time, trade)
      }
    }
  }

  encodeMessageRequest (secret: string, timestamp: number) {
    // create the json request object
    const method = 'GET'

    const requestPath = '/users/self/verify'
    
    // create the prehash string by concatenating required parts
    const message = timestamp + method + requestPath

    // decode the base64 secret
    var key = Buffer.from(secret, 'base64')

    // create a sha256 hmac with the secret
    var hmac = crypto.createHmac('sha256', key)

    // sign the require message with the hmac and base64 encode the result
    var cb_access_sign = hmac.update(message).digest('base64')
    return cb_access_sign
  }
      
}