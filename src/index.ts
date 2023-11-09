import {
  Connection,
  Keypair
} from '@solana/web3.js'
import fetch from 'node-fetch'
import { ILogObj, Logger } from 'tslog'
import pk from './.pk/pk'
import PhoenixConnector from './connectors/phoenixConnector'

import { LOOKBACK_INTERVAL, REQUIRE_AIRDROP, TRADING_PAIR, rpcUrl } from './mappings'
import AvellanedaStoikov from './strategies/asStrategy'
import GridTrading from './strategies/gridTradingStrategy'
import { DataStore, Order, Side } from './types'

import { CancelOrderParams } from '@ellipsis-labs/phoenix-sdk'
import BalanceManager from './balance/balance'
import Datafeed, { Source } from './datafeed/datafeed'

const log: Logger<ILogObj> = new Logger()

// @ts-ignore
globalThis.fetch = fetch

// TODO: Build our config settings here..
const MIN_TRADE_BUFFER: number = 10
const MIN_ORDER_BUFFER: number = 5000
const EXCHANGE_TRADE_WEIGHTS: number[] = [
  0.8,
  0.2,
  0.0
]
const EXCHANGE_BOOK_WEIGHTS: number[] = [
  0.8,
  0.2,
  0.0
]
const STRATEGY_NAME = 'AvellanedaStoikov'
const STRATEGY_TICK = 5
const PRICE_PCT_CHANGE = 1.01

const START_TIME: number = Date.now()

const web3Connect = async() => {
  try {
    log.info('Connecting to RPC')
    const endpoint = rpcUrl()
    dataStore.web3Connection = new Connection(endpoint)
    return dataStore.web3Connection
  } catch (error) {
    throw new Error(`Error connecting to RPC: ${error}`)
  }
}

const dataStore: DataStore = {
  isRunning: false,
  firstRun: true,
  lastExecuteTime: Math.floor(Date.now() / 1000),
  socket: null as unknown as WebSocket,
  web3Connection: null as unknown as Connection,
  previousMidPrice: null
  //tradeHashMap: new Map<number, Trade>()
}

const run = async() => {
  const timeWindowMs = LOOKBACK_INTERVAL * 1000
  // Load in the keypair from which we're trading from
  const trader = Keypair.fromSecretKey(new Uint8Array(pk))
  log.debug('Market Maker: ', trader.publicKey.toBase58())

  // Setup our connection to RPC
  await web3Connect()
  if(!dataStore.web3Connection) {
    throw new Error('Web3 not connected')
  }
  log.info(`Connected to RPC via ${dataStore.web3Connection.rpcEndpoint}`)

  // Parse our pair
  if(TRADING_PAIR === undefined){
    throw new Error('Trading pair is undefined')
  }
  
  // Setup our connector for exchange
  let connector
  // TODO: Make this a wrapped function for setting up the correct connection...
  if(true){
    connector = new PhoenixConnector(dataStore.web3Connection, [TRADING_PAIR])
    await connector.setupTrader(trader, REQUIRE_AIRDROP)
  } else{
    // const openBookConnector = new OpenBookConnector(trader, ['SOL/USDC'], dataStore.web3Connection, REQUIRE_AIRDROP)
  }
  await connector.connect()
  await connector.start()

  const bm = new BalanceManager(connector, dataStore.web3Connection, trader, log)
  
  // Track place transaction iterations
  // TODO: This is for Phoenix currently
  let count = 0

  // Setup our initial strategy
  let strategy
  if(STRATEGY_NAME.includes('GridTrading')){
    strategy = new GridTrading(0.3, 5, 2, 2, 'NormalDist', connector.getMarketRules())
  } else {
    strategy = new AvellanedaStoikov(3, 0.001, connector.getMarketRules())
  }

  const df = new Datafeed(dataStore, log, [TRADING_PAIR])
  await df.startFeed()

  /* eslint-disable no-constant-condition */
  while (true) {
    log.debug('Process heartbeat')

    await df.reconnect()

    const currentTime = Date.now()
    const timeLookback = currentTime - timeWindowMs

    const hm = df.getTrades(Source.coinbase)

    const recentTrades = new Map([...hm].filter(([key, value]) => key >= timeLookback))

    dataStore.lastExecuteTime = currentTime

    // Pre-run time filter
    if(currentTime <= (START_TIME + timeWindowMs)){
      log.debug('NOT ENOUGH TIME PASSED')
      await new Promise((r) => setTimeout(r, (STRATEGY_TICK * 1000)))
      continue
    }

    // Pre-run order book filter
    if(!df.hasData(Source.coinbase)) {
      log.debug('No orderbook data yet')
      await new Promise((r) => setTimeout(r, (STRATEGY_TICK * 1000)))
      continue
    }

    // Pre-run recent trades filter
    if(recentTrades.size === 0) {
      log.info('No recent trades for use of calculating system params')
      await new Promise((r) => setTimeout(r, (STRATEGY_TICK * 1000)))
      continue
    }

    // Update our account balance state
    await bm.updateBalance()
    // TODO: Something in here where if we don't have a balance, we don't trade...

    // TODO: We want to pipe in the order book from Phoenix / Coinbase / Binance / Etc (with weights)
    if(!STRATEGY_NAME.includes('GridTrading')){
      await strategy.calculateParameters(bm.getBalanceForMarket(), df.getOrderBook(Source.coinbase), df.cb.td.tradeHashMap)
    } else {
      await strategy.calculateParameters(bm.getBalanceForMarket(), df.getOrderBook(Source.coinbase))
    }
    
    // Gets our latest trade for last traded price
    const [, lastValue] = [...recentTrades].at(-1) || []
  
    // Order proposal generation
    const proposedOrders = strategy.generateOrders(lastValue, df.getOrderBook(Source.coinbase))

    // Post-run no orders to place filter
    if(proposedOrders.length === 0){
      log.info('No orders to place')
      await new Promise((r) => setTimeout(r, (STRATEGY_TICK * 1000)))
      continue
    }

    const traderOrders: Order[] = await connector.getTraderOrders()

    let finalOrdersProposed: Order[] = []
    let cancelableOrders: CancelOrderParams[] = []
    let existingPrices: [] = []
   
    // Post-run orders pricing and quantity match filter
    // if(traderOrders.length > 0){
    //   log.info(`Our current orders ${traderOrders.length }`)
    //   for(const [index, currentOrder] of traderOrders.entries()){
    //     log.info(`${currentOrder.side.toString()} order ${currentOrder.exchangeOrderId} ${currentOrder.quantity} @ $${currentOrder.price}`)
    //     // TODO: Map / filter / reduce??
    //     for(const proposedOrder of proposedOrders){
    //       if(currentOrder.side !== proposedOrder.side){
    //         // This doesn't match the side so we want to keep cycling through
    //         continue
    //       }
    //       if(currentOrder.price == proposedOrder.price && currentOrder.quantity == proposedOrder.quantity && currentOrder.side == proposedOrder.side) {
    //         log.debug('Proposed order matches current order, will not replace')
    //         continue
    //       }
    //       // @ts-ignore
    //       if(!existingPrices.includes(proposedOrder.price)){
    //         // Check to confirm that it's able to be cancelled..
    //         if(currentOrder.exchangeOrderId){
    //           const orderDetails: CancelOrderParams = {
    //             side: currentOrder.side == 'sell' ? _Side.Ask : _Side.Bid,
    //             priceInTicks: currentOrder.price,
    //             orderSequenceNumber: currentOrder.exchangeOrderId
    //           }
    //           cancelableOrders.push(orderDetails)
    //         }
    //         finalOrdersProposed.push(proposedOrder)
    //         // @ts-ignore
    //         existingPrices.push(proposedOrder.price)
    //       }
          
    //     }
    //   }
    //   if(finalOrdersProposed.length === 0){
    //     log.info('After comparing to currently placed orders, we have no orders to place')
    //     await new Promise((r) => setTimeout(r, (STRATEGY_TICK * 1000)))
    //     continue
    //   }
    // } else {
    //   log.info('We have no open orders')
    //   finalOrdersProposed = proposedOrders
    // }

    finalOrdersProposed = proposedOrders
    
    await df.phoenix.getOrderBookSnapshot()
    const exchangeOrderBook = df.phoenix.td.orderBook
    if(exchangeOrderBook.asks.length == 0 || exchangeOrderBook.bids.length == 0){
      // TODO: Handle this event so that you set a price you want (from external source is fine..)
      await new Promise((r) => setTimeout(r, (STRATEGY_TICK * 1000)))
      continue
    }
    const bestBid = exchangeOrderBook.bids[0].price
    const bestAsk = exchangeOrderBook.asks[0].price
    log.info(`Best bid in market: $${bestBid}`)
    log.info(`Best ask in market: $${bestAsk}`)

    // TODO: Weight with not just current market, but with others too
    const cbTobBid = df.cb.td.orderBook.bids[0].price
    const cbTobAsk = df.cb.td.orderBook.asks[0].price

    // If we have placed orders we need to check if we should change the orders
    // TODO: What if our prices HAVE changed on the other sides?
    if(traderOrders.length > 0){
      // Filter for mid price percent change
      const midPrice = Math.round((((bestBid + bestAsk * EXCHANGE_BOOK_WEIGHTS[0]) + (cbTobBid + cbTobAsk * EXCHANGE_BOOK_WEIGHTS[1])) / 4) * 1000) / 1000
      if(!dataStore.previousMidPrice){
        dataStore.previousMidPrice = midPrice
      }
      // TODO: This could be weighted mid as well...
      const pricePctChange: number = Number(Math.abs((dataStore.previousMidPrice - midPrice) / dataStore.previousMidPrice))
      dataStore.previousMidPrice = midPrice
      if(pricePctChange <= PRICE_PCT_CHANGE){
        log.info(`Current mid price of $${midPrice} and percent change ${Math.round(pricePctChange * 100)}% isn't beyond threshold ${Math.round((PRICE_PCT_CHANGE - 1) * 100)}% to continue order changes`)
        await new Promise((r) => setTimeout(r, (STRATEGY_TICK * 1000)))
        continue
      }
    }

    // TODO: We can technically just adjust our order price down to just above / below...
    // TODO: Sometimes we may want to place a market order vs a limit order (eg cross the books)
    // Filter for crossing book
    let _orders: Order[] = []
    _orders = finalOrdersProposed.filter((order) => {
      if(order.side === Side.buy){
        // TODO: We could push this to the TOB
        if(Number.isInteger(bestAsk) && order.price >= bestAsk) {
          log.warn(`Crossing asks when buying, order price of ${order.price} is more than ${bestAsk}`)
          return
        }
      }
      if(order.side === Side.sell){
        if(Number.isInteger(bestBid) && order.price <= bestBid) { 
          log.warn(`Crossing bids while selling, order price of ${order.price} is less than ${bestBid}`)
          return
        }
      }
      return order
    })
    
    // TODO: Review this, because perhaps we may have missed some orders...
    if(traderOrders.length > 0){
      //TODO: Review this logic as there's maybe a situation where we've removed based on filters..
      if(proposedOrders.length === finalOrdersProposed.length){
        // TODO: Should we put this into a single transaction
        await connector.cancelAllOrders()
      } else {
        await connector.cancelOrdersById(cancelableOrders)
      }
    // Dummy conditional just to ensure we cancel all.
    } else {
      await connector.cancelAllOrders()
    }
    
    const instructions = await connector.createOrders(_orders)

    // TODO: This is phoneix specific...
    // Every 5th iteration, add a withdraw funds instruction
    count++
 
    if (count % 5 == 0) {
      log.debug('Withdrawling our funds from contract as it\'s been 5 iterations')
      instructions.push(await connector.withdrawAll())
    }

    // Send place orders/withdraw transaction
    await connector.sendTransaction(instructions)
    // Sleep for QUOTE_REFRESH_FREQUENCY milliseconds
    await new Promise((r) => setTimeout(r, (STRATEGY_TICK * 1000)))
  }
}

run()