import * as Phoenix from '@ellipsis-labs/phoenix-sdk'
import {
  CancelMultipleOrdersByIdInstructionArgs,
  CancelMultipleOrdersByIdParams,
  CancelOrderParams,
  Client,
  LimitOrderTemplate,
  MarketData,
  MarketMetadata,
  SelfTradeBehavior,
  WithdrawParams,
  Side as _Side,
  getMakerSetupInstructionsForMarket,
  getPhoenixEventsFromTransactionSignature
} from '@ellipsis-labs/phoenix-sdk'

import {
  Connection,
  Keypair,
  LogsFilter,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction
} from '@solana/web3.js'
import BN from 'bn.js'
import fetch from 'node-fetch'
import { ILogObj, Logger } from 'tslog'

import { buildExplorerLink, getMarketAddress } from '../mappings'
import { Balance, ContractBalance, MarketRules, Order, OrderLevel, Side, Trade, TradeData } from '../types'
import { airdropSplTokensForMarketIxs } from '../utils/genericTokenMint'

import masterConfig from './phoenixMasterConfig'

let utf8Encode = new TextEncoder()

const S_NUM_0 = new BN(0)

const log: Logger<ILogObj> = new Logger()

// Work around for fetch
// @ts-ignore
globalThis.fetch = fetch

// Expected life time of order in seconds
// TODO: Push this into strategy and out through to this construction...
const ORDER_LIFETIME_IN_SECONDS: number = 360

export default class PhoenixConnector{
  client: Client
  web3Connection: Connection
  markets: string[]
  trader: Keypair
  marketPubkey: PublicKey
  airDrop: boolean
  marketData: MarketData
  marketState: any
  timesRan: number
  marketMessages: any[]
  td: TradeData
  MARKET_TICK_SIZE: number
  idl: any
  
  constructor(web3Connection: Connection, markets: string[]) {
    this.web3Connection = web3Connection
    this.timesRan = 0
    this.marketMessages = []
    this.markets = markets
    // TODO: This is a stub...
    this.marketPubkey = getMarketAddress(this.markets[0])
    this.td = {
      lastPrice: 0.0,
      lastMessageRecv: Math.floor(Date.now() / 1000),
      orderBook: {bids: [], asks: []},
      tradeHashMap: new Map<number, Trade>()
    }
  }

  setupTrader = async (trader: Keypair, airDrop: boolean) => {
    this.trader = trader
    this.airDrop = airDrop
  }

  connect = async () => {
    try {
      this.client = await Client.createFromConfig(this.web3Connection, masterConfig, false, false)
      await this.getMarketData()
      this.idl = await fetch(
        'https://raw.githubusercontent.com/Ellipsis-Labs/phoenix-v1/master/idl/phoenix_v1.json'
      ).then((res) => res.json())
    } catch (error) {
      log.error(error)
      throw new Error(`Error connecting to Phoenix Client SDK ${error}`)
    }
  }

  start = async () => {
    await this.setupMaker()
    if(this.airDrop){
      await this.airdrop()
    }
  }

  airdrop = async () => {
    // Request a SOL airdrop to send the transaction in this example. Only needed, and will only work, on devnet.
    // TODO: Add in check for wallet balance, not likely we need this from the RPC....
    try{
      await this.client.connection.requestAirdrop(this.trader.publicKey, 1_000_000_000)
    } catch(error){
      log.info('Error requesting Solana Airdrop on Devnet, this is restricted by ip / RPC so can be limited')
      log.error(`${error}`)
    }
    // To place a limit order, you will need base and quote tokens. For this devnet example, we mint the base and quote tokens from a token faucet.
    // To trade on mainnet, you will need to have base and quote tokens for the given market.
    const airdropSplIxs = await airdropSplTokensForMarketIxs(
      this.client,
      this.marketData,
      this.trader.publicKey
    )
    const airdropSplTx = new Transaction().add(...airdropSplIxs)
    const airdropTxId = await sendAndConfirmTransaction(
      this.web3Connection,
      airdropSplTx,
      [this.trader],
      {
        skipPreflight: true,
        commitment: 'confirmed',
      }
    )
    log.debug(
      `Airdrop Tx Link: ${buildExplorerLink(airdropTxId)}`
    )
  }

  getMarketRules = (): MarketRules => {
    // Setup our human readable details
    const marketMetaData = MarketMetadata.fromMarketState(this.marketState)
    const marketAddress = marketMetaData.address.toString()

    // TODO: Lookup the pairs or address from pair
    const _tradingPair = this.markets[0]
    const tradingPair = _tradingPair.split('/')
    const base = tradingPair[0]
    const quote = tradingPair[1]
    const baseLotSize = marketMetaData.baseLotSize
    const baseLotsPerBaseUnit = marketMetaData.baseLotsPerBaseUnit
    const priceDecimalPlaces = marketMetaData.priceDecimalPlaces
    const takerFeeBps = marketMetaData.takerFeeBps

    const minBaseIncrement = baseLotsPerBaseUnit / baseLotSize
    const minQuoteIncrement = 1 / (10 ** (priceDecimalPlaces))
    const minNotional = minBaseIncrement * minQuoteIncrement
    // Setup rules for the market trading
    const marketRules: MarketRules = {
      marketAddress: marketAddress,
      base: base,
      quote: quote,
      minBaseIncrement: minBaseIncrement,
      minNotional: minNotional,
      minQuoteIncrement: minQuoteIncrement,
      takerFee: takerFeeBps * 0.001
    }

    return marketRules
  }

  getBalanceInContract = async (): Promise<ContractBalance> => {
    // NOTE: This is per market, so if you want the entire picture you have to key in each market... Or loop..
    await this.getMarketData()
    const accountDetails = this.marketData.traders.get(this.trader.publicKey.toString())

    // NOTE: Get our params..
    const marketDivisor = new BN(this.marketData.baseLotsPerBaseUnit).toNumber()
    const marketRules = this.marketData.header

    const quoteDivisor = new BN(marketRules.baseLotSize).toNumber()
    //log.info(new BN(marketRules.quoteLotSize).toNumber())
    
    // TODO: Set this up as a util...
    const baseFree = (accountDetails?.baseLotsFree ? new BN(accountDetails?.baseLotsFree).toNumber() : 0) / marketDivisor
    const baseLocked = (accountDetails?.baseLotsLocked ? new BN(accountDetails?.baseLotsLocked).toNumber() : 0) / marketDivisor
    const baseBalance: Balance = {
      asset: this.markets[0].split('/')[0],
      amount: baseFree + baseLocked,
      free: baseFree,
      locked: baseLocked
    }

    const quoteFree = (accountDetails?.quoteLotsFree ? new BN(accountDetails?.quoteLotsFree).toNumber() : 0) / quoteDivisor
    const quoteLocked = (accountDetails?.quoteLotsLocked ? new BN(accountDetails?.quoteLotsLocked).toNumber() : 0) / quoteDivisor
    const quoteBalance: Balance = {
      asset: this.markets[0].split('/')[1],
      amount: quoteFree + quoteLocked,
      free: quoteFree,
      locked: quoteLocked
    }

    const accountBalance: ContractBalance = {
      base: baseBalance,
      quote: quoteBalance,
      trading_pair: this.markets[0],
      market: this.marketPubkey.toString()
    }
    return accountBalance
  }

  getMarketData = async () => {
    await this.client.refreshAllMarkets(false)
    this.marketState = this.client.marketStates.get(this.marketPubkey.toString())
    this.marketData = this.marketState?.data
    if (!this.marketData) {
      throw new Error('Market data not found')
    }
  }

  getTraderOrders = async () => {
    await this.getMarketData()
    const traderIdx = this.marketData.traderPubkeyToTraderIndex.get(this.trader.publicKey.toString())
    const orders: Order[] = []
    this.marketData.asks.map((ask) => {
      if(traderIdx == ask[1].traderIndex){
        const order: Order = {
          exchangeOrderId: ask[0].orderSequenceNumber,
          price: this.marketState.ticksToFloatPrice(new BN(ask[0].priceInTicks).toNumber()),
          quantity: Number(ask[1].numBaseLots.toString()) / Number(new BN(this.marketData.baseLotsPerBaseUnit).toNumber()),
          side: Side.sell,
          expireTs: Number(new BN(ask[1].lastValidUnixTimestampInSeconds).toNumber()),
          expireBlock: Number(new BN(ask[1].lastValidSlot).toNumber())
        }
        // NOTE: Check for expired order
        if(order.expireTs && order.expireTs > Math.floor(Date.now() / 1000)){
          orders.push(order)
        }
      }
    })
    this.marketData.bids.map((bid) => {
      if(traderIdx == bid[1].traderIndex){
        const order: Order = {
          exchangeOrderId: bid[0].orderSequenceNumber,
          price: this.marketState.ticksToFloatPrice(new BN(bid[0].priceInTicks).toNumber()),
          quantity: Number(bid[1].numBaseLots.toString()) / Number(new BN(this.marketData.baseLotsPerBaseUnit).toNumber()),
          side: Side.buy,
          expireTs: Number(new BN(bid[1].lastValidUnixTimestampInSeconds).toNumber()),
          expireBlock: Number(new BN(bid[1].lastValidSlot).toNumber())
        }
        // NOTE: Check for expired order
        if(order.expireTs && order.expireTs > Math.floor(Date.now() / 1000)){
          orders.push(order)
        }
      }
    })
    return orders
  }

  getOrderBookSnapshot = async () => {
    await this.getMarketData()
    const bids: any[] = []
    const asks: any[] = []

    this.td.orderBook.bids = this.marketData.bids.map((bid) => {
      const quantity: number = Number(new BN(bid[1].numBaseLots).toNumber() / new BN(this.marketData.baseLotsPerBaseUnit).toNumber())
      const price: number = Number(this.marketState.ticksToFloatPrice(new BN(bid[0].priceInTicks).toNumber()))
      return {price: price, quantity: quantity} as OrderLevel
    })
    this.td.orderBook.asks = this.marketData.asks.map((ask) => {
      const quantity: number = Number(new BN(ask[1].numBaseLots).toNumber() / new BN(this.marketData.baseLotsPerBaseUnit).toNumber())
      const price: number = Number(this.marketState.ticksToFloatPrice(new BN(ask[0].priceInTicks).toNumber()))
      return {price: price, quantity: quantity} as OrderLevel
      // TODO: Check if orders are expired?
      //log.info(_ask)
      // if(ask[1].lastValidSlot != S_NUM_0 && ask[1].lastValidSlot < this.client.clock.slot) {
      //   //log.info('Order Expired')
      //   return
      // }
      // if(ask[1].lastValidUnixTimestampInSeconds != S_NUM_0 && ask[1].lastValidUnixTimestampInSeconds < this.client.clock.unixTimestamp) {
      //   //log.info('Order Expired')
      //   return
      // }
    })
  }


  setupMaker = async () => {
    await this.getMarketData()
    // If the trader is a new maker (has not placed limit orders previously), you will need to create associated token accounts for the base and quote tokens, and claim a maker seat on the market.
    // This function creates a bundle of new instructions that includes:
    // - Create associated token accounts for base and quote tokens, if needed
    // - Claim a maker seat on the market, if needed
    try{
      const setupNewMakerIxs = await getMakerSetupInstructionsForMarket(
        this.web3Connection,
        this.marketState,
        this.trader.publicKey
      )
      if (setupNewMakerIxs.length !== 0) {
        const setupTx = new Transaction().add(...setupNewMakerIxs)
        const setupTxId = await sendAndConfirmTransaction(
          this.web3Connection,
          setupTx,
          [this.trader],
          {
            skipPreflight: true,
            commitment: 'confirmed',
          }
        )
        log.debug(
          `Setup Tx Link: ${buildExplorerLink(setupTxId)}`
        )
      } else {
        log.info('No setup required. Continuing...')
      }
    } catch(err){
      log.error(err)
      return
    }
        
  }
  
  createOrders = async (orders: Order[]) => {
    this.timesRan++
    const currentTime = Math.floor(Date.now() / 1000)
    const instructions: any[] = []
    for(const order of orders){
      const orderTemplate: LimitOrderTemplate = {
        side: order.side === Side.sell ? _Side.Ask : _Side.Bid,
        priceAsFloat: order.price,
        sizeInBaseUnits: order.quantity,
        selfTradeBehavior: SelfTradeBehavior.CancelProvide,
        clientOrderId: 1,
        useOnlyDepositedFunds: false,
        lastValidSlot: undefined,
        lastValidUnixTimestampInSeconds: currentTime + ORDER_LIFETIME_IN_SECONDS,
      }
      const limitOrderIx = this.client.getLimitOrderInstructionfromTemplate(
        this.marketPubkey.toBase58(),
        this.trader.publicKey,
        orderTemplate
      )
      log.debug(
        `Propose ${order.side}`,
        order.quantity.toFixed(this.marketState.getPriceDecimalPlaces()),
        '@ $',
        order.price.toFixed(this.marketState.getPriceDecimalPlaces())
      )
      instructions.push(limitOrderIx)
    }
    return instructions
  }

  cancelAllOrders = async () => {
    // Before quoting, we cancel all outstanding orders
    const cancelAll = this.client.createCancelAllOrdersInstruction(
      this.marketPubkey.toString(),
      this.trader.publicKey
    )
    // Note we could bundle this with the place order transaction below, but we choose to cancel
    // seperately since getting the price could take an non-deterministic amount of time
    if(cancelAll && this.web3Connection) {
      try {
        const cancelTransaction = new Transaction().add(cancelAll)
        const txid = await sendAndConfirmTransaction(
          this.web3Connection,
          cancelTransaction,
          [this.trader],
          {
            skipPreflight: true,
            commitment: 'confirmed',
          }
        )

        log.debug(
          `Cancel tx link: ${buildExplorerLink(txid)}`
        )
      } catch (err) {
        log.error('Error: ', err)
        return
      }
    }
  }

  cancelOrdersById = async (cancellableOrders: CancelOrderParams[]) => {
    const params: CancelMultipleOrdersByIdParams = {orders: cancellableOrders}
    const args: CancelMultipleOrdersByIdInstructionArgs = {params: params}
    const cancelOrders = this.client.createCancelMultipleOrdersByIdInstruction(
      args,
      this.marketPubkey.toString(),
      this.trader.publicKey
    )
    if(cancelOrders && this.web3Connection){
      try {
        const cancelTransaction = new Transaction().add(cancelOrders)
        const txid = await sendAndConfirmTransaction(
          this.web3Connection,
          cancelTransaction,
          [this.trader],
          {
            skipPreflight: true,
            commitment: 'confirmed',
          }
        )

        log.debug(
          `Cancel tx link: ${buildExplorerLink(txid)}`
        )
      } catch (err) {
        log.error('Error: ', err)
        return
      }
    }
  }

  withdrawAll = async () => {
    // Create WithdrawParams. Setting params to null will withdraw all funds
    const withdrawParams: WithdrawParams = {
      quoteLotsToWithdraw: null,
      baseLotsToWithdraw: null,
    }
  
    const placeWithdraw = this.client.createWithdrawFundsInstruction(
      {
        withdrawFundsParams: withdrawParams,
      },
      this.marketPubkey.toString(),
      this.trader.publicKey
    )
    return placeWithdraw
  }

  sendTransaction = async (instructions: any) => {
    try {
      const phoenixTransaction = new Transaction().add(...instructions)

      const phoenixTxId = await sendAndConfirmTransaction(
        this.web3Connection,
        phoenixTransaction,
        [this.trader],
        {
          skipPreflight: true,
          commitment: 'confirmed',
        }
      )
        
      log.info(
        `Tx link: ${buildExplorerLink(phoenixTxId)}`
      )
    } catch (err) {
      log.error('Error: ', err)
      return
    }
  }

  fetchTransaction = async (signature:string) => {
    const eventInstructions = (await getPhoenixEventsFromTransactionSignature(this.web3Connection, signature)).instructions

    for(const event of eventInstructions){
      const weCareAbout = event.events.filter((event) => {
        if(event.__kind === 'Fill'){
          for(const fill of event.fields) {
            const exchangeOrderId = new BN(fill.orderSequenceNumber).toNumber()
            const price: number = Number(this.marketState.ticksToFloatPrice(new BN(fill.priceInTicks).toNumber()))
            const remaining = new BN(fill.baseLotsFilled).toNumber() / new BN(this.marketData.baseLotsPerBaseUnit).toNumber()
            const filled: number = Number(new BN(fill.baseLotsFilled).toNumber() / new BN(this.marketData.baseLotsPerBaseUnit).toNumber())
            const totalOrderSize = remaining + filled
            log.debug(`FILL - Order ${exchangeOrderId} of ${filled}/${totalOrderSize} filled at $${price}`)
        
            const quantity = filled
            const side: string = fill.makerId ? 'sell' : 'buy'
            const time: number = Date.now()
            const trade = {price: price, quantity: quantity, side: side} as Trade
          
            // TODO: Need to update books or request a new snapshot...
            this.td.lastPrice = price
            this.td.tradeHashMap.set(time, trade)
          }
        }
        if(event.__kind === 'FillSummary'){
          // We can ignore this for our data.
          for(const fillSummary of event.fields){
            // NOTE: This could be useful in identifying your counterparty.
            const clientOrderId = new BN(fillSummary.clientOrderId).toNumber()
            const tradeId = fillSummary.index
            const quoteAmount = this.marketState.quoteLotsToQuoteUnits(new BN(fillSummary.totalQuoteLotsFilled).toNumber())
            const filledAmount = new BN(fillSummary.totalBaseLotsFilled).toNumber() / new BN(this.marketData.baseLotsPerBaseUnit).toNumber()
            const totalFees = this.marketState.quoteLotsToQuoteUnits(new BN(fillSummary.totalFeeInQuoteLots).toNumber())
            const price = quoteAmount / filledAmount
            if(isNaN(price)){
              continue
            }
            log.debug(`SUMMARY - Trade ${tradeId} for ${clientOrderId} of ${filledAmount} filled at $${price} with a fee of $${totalFees}`)
          }
        }
        if(event.__kind === 'Place'){
          for(const order of event.fields){
            // NOTE: This could be useful in identifying your counterparty.
            const clientOrderId = order.clientOrderId.toString()
            const exchangeOrderId = order.orderSequenceNumber.toString()
            const price = this.marketState.ticksToFloatPrice(new BN(order.priceInTicks).toNumber())
            const remaining = new BN(order.baseLotsPlaced).toNumber() / new BN(this.marketData.baseLotsPerBaseUnit).toNumber()
            log.debug(`PLACE - Order ${exchangeOrderId} for ${clientOrderId} of ${remaining} at $${price} placed`)
          }
          // TODO: Update books
          // const quantity = new BN(ask[1].numBaseLots).toNumber() / new BN(this.marketData.baseLotsPerBaseUnit).toNumber()
          // const price = this.marketState.ticksToFloatPrice(new BN(ask[0].priceInTicks).toNumber())
          // return [+price, +quantity ]
        }
        if(event.__kind === 'Reduce'){
          for(const order of event.fields){
            // NOTE: This could be useful in identifying your counterparty.
            const clientOrderId = order.index.toString()
            const exchangeOrderId = order.orderSequenceNumber.toString()
            const price: number = Number(this.marketState.ticksToFloatPrice(new BN(order.priceInTicks).toNumber()))
            const removed: number = Number(new BN(order.baseLotsRemoved).toNumber() / new BN(this.marketData.baseLotsPerBaseUnit).toNumber())
            const remaining: number = Number(new BN(order.baseLotsRemaining).toNumber() / new BN(this.marketData.baseLotsPerBaseUnit).toNumber())
            if(remaining > 0){
              log.debug(`REDUCE - Order ${exchangeOrderId} for ${clientOrderId} of ${remaining} at $${price} reduced by ${removed}`)
            } else {
              log.debug(`CANCEL - Order ${exchangeOrderId} for ${clientOrderId} of ${remaining} at $${price} cancelled with ${removed}`)
            }
          }
        }
        if(event.__kind === 'ExpiredOrder'){
          for(const order of event.fields){
            // NOTE: This could be useful in identifying your counterparty.
            const clientOrderId = order.index.toString()
            const exchangeOrderId = order.orderSequenceNumber.toString()
            const makerId = order.makerId.toString()
            const price: number = Number(this.marketState.ticksToFloatPrice(new BN(order.priceInTicks).toNumber()))
            const removed: number = Number(new BN(order.baseLotsRemoved).toNumber() / new BN(this.marketData.baseLotsPerBaseUnit).toNumber())
            log.debug(`EXPIRE - Order ${exchangeOrderId} placed by ${makerId} for ${clientOrderId} of ${removed} at $${price} expired`)
          }
        }
      })
      if(weCareAbout.length > 0){
        this.marketMessages.push(weCareAbout)
      }
    }
  }

  async startFeed () {
    await this.connect()
    const logFilter = new PublicKey('PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY') as LogsFilter
    try {
      log.info('Subscribed to Phoenix trades and order book')
      const id = this.web3Connection.onLogs(
        logFilter,
        (event, _) => {
          // TODO: From here we can get the 'signature' and then hit the RPC to process the transaction
          // TODO: Filter these from what want which is trades??
          const tradeEvents = event.logs.filter((_log) => {
            if(['PlaceLimitOrder', 'Swap', 'ReduceOrder',
              'ReduceOrderWithFreeFunds', 'SwapWithFreeFunds',
              'PlaceLimitOrderWithFreeFunds', 'CancelAllOrders',
              'CancelAllOrdersWithFreeFunds', 'CancelUpTo',
              'CancelUpToWithFreeFunds', 'CancelMultipleOrdersById',
              'CancelMultipleOrdersByIdWithFreeFunds', 'WithdrawFunds',
              'DepositFunds', 'RequestSeat',
              'PlaceMultiplePostOnlyOrders', 'Log',
              'PlaceMultiplePostOnlyOrdersWithFreeFunds', 'InitializeMarket',
              'ClaimAuthority', 'NameSuccessor',
              'ChangeMarketStatus', 'ChangeSeatStatus',
              'RequestSeatAuthorized', 'EvictSeat',
              'ForceCancelOrders', 'CollectFees',
              'ChangeFeeRecipient'
            ].some((_event) => _log.includes(_event))) {
              this.fetchTransaction(event.signature)
              return _log
            }
          })
        }
      )
    } catch (err) {
      log.error(err)
    }
  }

  async watch() {    
    // UNUSED FUNCTION POTENTIALLY IN PLACE OF LISTEN...
    const marketConfig = Array.from(this.client.marketConfigs.values()).find(
      (market) => market.name === this.markets[0]
    )
  
    if (!marketConfig) throw new Error('Market not found')
  
    const marketAddress = marketConfig.marketId
     
    let lastLadder: Phoenix.UiLadder | null = null
    let updates = 0
    while (updates < 10) {
      const ladder = this.client.getUiLadder(marketAddress)
      if (JSON.stringify(ladder) !== JSON.stringify(lastLadder)) {
        console.clear()
        console.log('Ladder update', updates + 1, 'of', 10, '\n')
        this.client.printLadder(marketAddress)
        lastLadder = ladder
        updates++
      }
      const ms = this.client.marketStates.get(marketConfig.marketId)
      const traderPubkeyToTraderIndex =
      ms?.data.traders
      console.log(traderPubkeyToTraderIndex)
      await this.client.refreshMarket(marketAddress,false)
      await new Promise((res) => setTimeout(res, 500))
    }
  }
}
