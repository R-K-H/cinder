import { ILogObj, Logger } from 'tslog'
import { LOOKBACK_INTERVAL } from '../mappings'
import { ContractBalance, MarketRules, Order, OrderBook, Side, Trade } from '../types'
import { countDecimals } from '../utils/utils'
const log: Logger<ILogObj> = new Logger()

const MIN_SPREAD_PCT: number = 0.12
// Edge in cents on quote. Places bid/ask at fair price -/+ edge
const QUOTE_EDGE: number = 0.02

// TODO: Spread on active markets for the larger market maker backstop is 20 bips or 0.2%.
export default class AvellanedaStoikov {
  alpha: number
  eta: number
  etaBase: number
  gamma: number
  tickSize: number
  sigma: number
  inventory: number
  lastTradePrice: number
  levels: number
  minPriceIncrement: number
  portfolioMaxValue: number
  portfolioMinValue: number
  marketRules: MarketRules

  constructor(levels: number = 1, minPriceIncrement: number, marketRules: MarketRules) {
    this.alpha = 0
    this.eta = 0
    this.etaBase = 0
    this.gamma = 0
    this.tickSize = LOOKBACK_INTERVAL
    this.sigma = 0
    this.inventory = 0
    this.lastTradePrice = 0
    this.levels = levels
    this.minPriceIncrement = minPriceIncrement
    this.portfolioMaxValue = 0
    this.portfolioMinValue = 0
    this.marketRules = marketRules
  }

  async calculateParameters(accontBalance: ContractBalance, orderBook: OrderBook, trades: Map<number, Trade>): Promise<void> {
    let deltaSum = 0
    let deltaSquareSum = 0

    for (const trade of trades){
      const { price, quantity, side } = trade[1]
      let delta = quantity
      if (this.inventory !== 0) {
        delta = this.gamma * (price - this.lastTradePrice) / this.tickSize
      }
      deltaSum += delta
      deltaSquareSum += delta * delta
      this.lastTradePrice = price
    }

    await this.processInventoy(accontBalance, orderBook)

    this.sigma = this.calculateVolatility(trades)

    const n = trades.size
    this.alpha = (deltaSum / (n * deltaSquareSum))  // TODO: This is supposedly our setting param, not derrived
    if(this.alpha < 0.000001) {
      this.alpha = 0.000001
    }
    if(this.alpha > 100) {
      this.alpha = 10
    }
    this.eta = this.calculateOrderArrivalRate(orderBook)
    this.gamma = trades.size / this.tickSize
    log.debug(`Alpha: ${this.alpha}`)
    log.debug(`Gamma: ${this.gamma}`)
    log.debug(`Eta: ${this.eta}`)
    log.debug(`Sigma: ${this.sigma}`)
  }

  calculateVolatility(trades: Map<number, Trade>): number {
    // Calculate the log returns.
    let logReturns: number[] = []

    const _trades = Array.from(trades.values())

    _trades.map((currentValue, index, array) => {
      if (index === 0) {
        // For the first element, return 0 or any default value you prefer
        return 0
      } else {
        let return_i = Math.log(_trades[index].price / _trades[index - 1].price)
        logReturns.push(return_i)
      }
    })

    if(logReturns.length === 0){
      return 0
    }
  
    // Calculate the standard deviation of the log returns.
    let mean = logReturns.reduce((a, b) => a + b) / logReturns.length
    let squareDiffs = logReturns.map(value => (value - mean) ** 2)
    let variance = squareDiffs.reduce((a, b) => a + b) / squareDiffs.length

    return Math.sqrt(variance)
  }

  calculateOrderArrivalRate(orderBook: OrderBook): number {
    // TODO: Need to setup something here to calculate order arrival rate not just the entire orderbook...
    let totalOrders = orderBook.bids.length + orderBook.asks.length
    let eta = totalOrders / this.tickSize
    return eta
  }

  normalizeBetweenNegativeOneAndOne(value: number): number {
    // Ensure the value is within the given range
    value = Math.min(Math.max(value, this.portfolioMinValue), this.portfolioMaxValue)
  
    // Calculate the normalized value between -1 and 1
    return (2 * (value - this.portfolioMinValue) / (this.portfolioMaxValue - this.portfolioMinValue)) - 1
  }

  processInventoy(accountBalance: ContractBalance, orderBook: OrderBook): void {
    // Get current midprice
    const midPrice = this.calculateMidPrice(orderBook)
    
    // Fetch balances
    const baseAsset: number = (accountBalance.base.amount)
    const quoteAsset: number = (accountBalance.quote.amount)

    this.portfolioMaxValue = quoteAsset + (baseAsset * midPrice)
    this.portfolioMinValue = -this.portfolioMaxValue
    log.info(`Total Portfolio USD Value: ~$${Math.round(this.portfolioMaxValue * 100) / 100}`)
    // TODO: Push rounding into utils...
    log.info(`Portfolio Value allocated in ${this.marketRules.base} ~${Math.round(baseAsset * 100) / 100} (~$${Math.round((baseAsset * midPrice) * 100) / 100})`)
    log.info(`Portfolio Value allocated in ${this.marketRules.quote} ~$${Math.round((quoteAsset) * 100) / 100}`)
    this.calculateDelta(baseAsset, quoteAsset, midPrice)
  }

  calculateDelta(baseAsset:number, quoteAsset: number, midPrice: number) {
    // Calculate your net delta
    // TODO: We could weight what we have in orders as we're interested in what potentially
    // could happen to delta as well...
    const dollarRatio = quoteAsset - (baseAsset * midPrice) // NOTE: Normalize to base
    // NOTE: If delta is negative it means we've got inventory we should be betting
    // long (eg predict the price is moving up) or we need to be pricing more aggressively
    // on the sell side. The counter example (+) is conversely true.
    
    this.inventory = this.normalizeBetweenNegativeOneAndOne(dollarRatio)
    log.info(`Delta: ${this.inventory}`)
  }

  // TODO: Review this as it does appear we're only concerned with the sign, not the maginitude
  processTrade(trade: Trade): number {
    const { price, quantity } = trade

    if (this.inventory === 0) {
      const delta = this.alpha * (quantity - this.eta)
      this.inventory = delta
    } else {
      const delta = this.gamma * (price - this.lastTradePrice) / this.tickSize
      this.inventory += delta
    }

    this.lastTradePrice = price
    const signal = Math.sign(this.inventory)
    return signal
  }

  calculateMidPrice(orderbook: OrderBook): number {
    let bestBid = Math.max(...orderbook.bids.map(order => order[0]))
    let bestAsk = Math.min(...orderbook.asks.map(order => order[0]))
    return (bestBid + bestAsk) / 2
  }

  generateOrders(trade: Trade, orderbook: OrderBook): Order[] {
    const orders: Order[] = []
    if(trade === undefined){
      return orders
    }

    // TODO: Pipe in several or aggregate orderbooks for accurate pricing (or weight one over another)
    const midPrice = this.calculateMidPrice(orderbook)
    let mu = -1 * (this.alpha / 2) * (this.sigma ** 2)
    let k = this.alpha * (this.sigma ** 2) / 2
    log.info(`Mid Price: ${midPrice}`)

    // The optimal bid price
    let bid = midPrice * (1 - (mu / this.gamma) + (Math.exp(k - this.inventory) - 1) / (this.alpha * this.eta))
    // The optimal ask price
    let ask = midPrice * (1 - (mu / this.gamma) + (Math.exp(k + this.inventory + 1) - 1) / (this.alpha * this.eta))

    // TODO: Set some min spread or something here.
    let priceStepIncrement = Math.max((midPrice - bid), (ask - midPrice))
    
    // Calculate the bid and ask adjustment factors
    let askPrice = Math.max((midPrice + this.minPriceIncrement), ask)
    let bidPrice = Math.max((midPrice - this.minPriceIncrement), bid)

    log.debug(`Strategy ask: ${ask}`)
    log.debug(`Strategy bid: ${bid}`)

    log.debug(`Strategy max ask: ${askPrice}`)
    log.debug(`Strategy max bid: ${bidPrice}`)

    const roundingValue = countDecimals(this.marketRules.minBaseIncrement)

    for (let i = 1; i <= this.levels; i++) {
      // log.info(`Bid Price: ${bidPrice}`)
      // log.info(`Multiple ${(midPrice - bidPrice)}`)
      if(i > 1){
        const askPriceModifier = Math.max((askPrice - midPrice), this.minPriceIncrement)
        const bidPriceModifier = Math.min((midPrice - bidPrice), -this.minPriceIncrement)
        log.debug(`Stratey level ${i} ask: ${(askPrice - midPrice)}`)
        log.debug(`Stratey level ${i} bid: ${(midPrice - bidPrice)}`)
        askPrice = midPrice + (askPriceModifier * i)
        bidPrice = midPrice + (bidPriceModifier * i)
      }
      
      if(!Number.isNaN(askPrice) && Number.isFinite(askPrice)) {
        // TODO: We should set a realistic if we SOL on an upswing, we're fine with that :)
        if(askPrice > midPrice && askPrice < midPrice * midPrice){
          orders.push({
            price: Number((askPrice).toFixed(roundingValue)),
            quantity: Number(Number('2').toFixed(roundingValue)),
            side: Side.sell,
          })
        } else {
          orders.push({
            price: Number((midPrice * 2).toFixed(roundingValue)),
            quantity: Number(Number('2').toFixed(roundingValue)),
            side: Side.sell,
          })
        }
      }
      if(!Number.isNaN(bidPrice) && Number.isFinite(bidPrice)) {
        if(bidPrice > 0 && bidPrice < midPrice){
          orders.push({
            price: Number((bidPrice).toFixed(roundingValue)),
            quantity: Number(Number('2').toFixed(roundingValue)),
            side: Side.buy,
          })
        } else {
          orders.push({
            price: Number((0.001).toFixed(roundingValue)),
            quantity: Number(Number('2').toFixed(roundingValue)),
            side: Side.buy,
          })
        }
      }
    }

    return orders
  }

  calculateEta(level: number): number {
    // Custom logic to calculate eta for each level
    // You can adjust this based on your specific strategy
    return this.eta * level
  }
}
