import { MarketState } from '@ellipsis-labs/phoenix-sdk'
import { ContractBalance, Order, OrderBook, Trade } from '../types'

export default abstract class Strategy {
  quantity: number
  abstract calculateParameters(accontBalance: ContractBalance, orderBook: OrderBook, trades: Map<number, Trade>, marketState: MarketState): Promise<void>
  abstract generateOrders(): Order[]
}