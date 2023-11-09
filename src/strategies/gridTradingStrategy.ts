import { ILogObj, Logger } from 'tslog'
import { ContractBalance, MarketRules, Order, OrderAmounts, OrderBook, Side } from '../types'
import { countDecimals } from '../utils/utils'
import Strategy from './strategy'
const log: Logger<ILogObj> = new Logger()

export default class GridTrading extends Strategy {
  private gridSpacing: number
  private upperGridLevels: number
  private lowerGridLevels: number
  private currentPrice: number
  private portfolioBaseQuantity: number
  private portfolioQuoteQuantity: number
  portfolioMaxValue: number
  portfolioMinValue: number
  // TODO: Construct interface for market details, such that we have base, quote, precision, min notional etc...
  marketRules: MarketRules
  maxOrderSize: number
  // TODO: Need to enum this..
  orderSizingRegime: string

  constructor(gridSpacing: number, upperGridLevels: number, lowerGridLevels: number, maxOrderSize: number, orderSizingRegime: string = 'Tight', marketRules: MarketRules) {
    super()
    this.gridSpacing = gridSpacing
    this.upperGridLevels = upperGridLevels
    this.lowerGridLevels = lowerGridLevels 
    this.marketRules = marketRules
    this.maxOrderSize = maxOrderSize
    this.orderSizingRegime = orderSizingRegime
  }

  override async calculateParameters(accontBalance: ContractBalance, orderBook: OrderBook): Promise<void> {
    const midPrice = this.calculateMidPrice(orderBook)
    this.currentPrice = midPrice
    this.processInventoy(accontBalance, orderBook)
  }

  processInventoy(accountBalance: ContractBalance, orderBook: OrderBook): void {
    // Get current midprice
    const midPrice = this.calculateMidPrice(orderBook)
    
    // Fetch balances
    const baseAsset: number = (accountBalance.base.amount)
    const quoteAsset: number = (accountBalance.quote.amount)

    // Calculate balances
    this.portfolioMaxValue = quoteAsset + (baseAsset * midPrice)
    this.portfolioMinValue = -this.portfolioMaxValue
    this.portfolioBaseQuantity = baseAsset
    this.portfolioQuoteQuantity = quoteAsset
    log.info(`Total Portfolio USD Value: ~$${Math.round(this.portfolioMaxValue * 100) / 100}`)
    // TODO: Push rounding into utils...
    log.info(`Portfolio Value allocated in ${this.marketRules.base} ~${Math.round(baseAsset * 100) / 100} (~$${Math.round((baseAsset * midPrice) * 100) / 100})`)
    log.info(`Portfolio Value allocated in ${this.marketRules.quote} ~$${Math.round((quoteAsset) * 100) / 100}`)
  }

  calculateMidPrice(orderbook: OrderBook): number {
    let bestBid = Math.max(...orderbook.bids.map(order => order[0]))
    let bestAsk = Math.min(...orderbook.asks.map(order => order[0]))
    return (bestBid + bestAsk) / 2
  }

  boxMullerTransform(min: number, max: number, skew: number): number {
    let u = 0, v = 0
    while(u === 0) u = Math.random() //Converting [0,1) to (0,1)
    while(v === 0) v = Math.random()
    let num = Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v )
    
    num = num / 10.0 + 0.5 // Translate to 0 -> 1
    if (num > 1 || num < 0) 
      num = this.boxMullerTransform(min, max, skew) // resample between 0 and 1 if out of range
    
    else{
      //num = Math.pow(num, skew) // Skew
      num *= max - min // Stretch to fill range
      num += min // offset to min
    }
    return num
  }

  pyramid (arr: Array<number>): Array<number> {
    var newArr = []

    // sort numerically
    arr.sort(function (a, b) {
      return a - b
    })

    // put the biggest in new array
    // @ts-ignore
    newArr.push(arr.pop())

    // keep grabbing the biggest remaining item and alternate
    // between pushing and unshifting onto the new array
    while (arr.length) {
      // @ts-ignore
      newArr[arr.length % 2 === 0 ? 'push' : 'unshift'](arr.pop())
    }

    return newArr
  }

  calculateOrderSizes(): OrderAmounts {
    // TODO: Calculate these based off of the amount you have too...
    switch(this.orderSizingRegime){
    case('NormalDist'):
      // 2, 5, 2
      return {
        asks: this.pyramid(Array.from({ length: this.lowerGridLevels }, (_, i) => this.boxMullerTransform(this.marketRules.minQuoteIncrement * (i + 1), this.maxOrderSize, 0))),
        bids: this.pyramid(Array.from({ length: this.upperGridLevels }, (_, i) => this.boxMullerTransform(this.marketRules.minQuoteIncrement * (i + 1), this.maxOrderSize, 0)))
      }
    case('Tight'):
      // 5, 3, 1
      return {
        asks: Array.from({ length: this.lowerGridLevels }, (_, i) => this.maxOrderSize - (this.marketRules.minQuoteIncrement * (i + 1) * this.gridSpacing)),
        bids: Array.from({ length: this.upperGridLevels }, (_, i) => this.maxOrderSize - (this.marketRules.minQuoteIncrement * (i + 1) * this.gridSpacing))
      }
    case('Wide'):
      // 1, 3, 5
      return {
        asks: Array.from({ length: this.lowerGridLevels }, (_, i) => this.maxOrderSize - (this.marketRules.minQuoteIncrement * (i + 1) * this.gridSpacing)).reverse(),
        bids: Array.from({ length: this.upperGridLevels }, (_, i) => this.maxOrderSize - (this.marketRules.minQuoteIncrement * (i + 1) * this.gridSpacing)).reverse()
      }
    default:
      return {
        asks: Array.from({ length: this.lowerGridLevels }, (_, i) => this.maxOrderSize).reverse(),
        bids: Array.from({ length: this.upperGridLevels }, (_, i) => this.maxOrderSize).reverse()
      }
    }
  }

  calculateOrderPrices(): OrderAmounts {
    return {
      asks: Array.from({ length: this.lowerGridLevels }, (_, i) => this.currentPrice - (i + 1) * this.gridSpacing),
      bids: Array.from({ length: this.upperGridLevels }, (_, i) => this.currentPrice + (i + 1) * this.gridSpacing),
    }
  }

  override generateOrders(): Order[] {
    const orders: Order[] = []

    const orderPrices = this.calculateOrderPrices()
    const orderSizes = this.calculateOrderSizes()

    const roundingValue = countDecimals(this.marketRules.minBaseIncrement)

    for (const [index, sellPrice] of orderPrices.asks.entries()) {
      orders.push({
        price: Number((sellPrice).toFixed(roundingValue)),
        quantity: Number(Number(orderSizes.asks[index]).toFixed(roundingValue)),
        side: Side.sell,
      })
    }

    for (const [index, buyPrice] of orderPrices.bids.entries()) {
      orders.push({
        price: Number((buyPrice).toFixed(roundingValue)),
        quantity: Number(Number(orderSizes.bids[index]).toFixed(roundingValue)),
        side: Side.buy,
      })
    }
    
    return orders
  }
}
