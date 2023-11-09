import { TokenConfig } from '@ellipsis-labs/phoenix-sdk'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  TokenAccountsFilter
} from '@solana/web3.js'
import { ILogObj, Logger } from 'tslog'
import PhoenixConnector from '../connectors/phoenixConnector'
import masterConfig from '../connectors/phoenixMasterConfig'
import { MODE } from '../mappings'
import { Balance, ContractBalance } from '../types'

export default class BalanceManager{
  connector: PhoenixConnector
  web3Connection: Connection
  markets: string[]
  trader: Keypair
  log: Logger<ILogObj>
  contractBalances: ContractBalance
  solBalance: number
  walletBalance: Map<string, Balance>
  totalBalance: Map<string, Balance>

  constructor(connector: PhoenixConnector, web3Connection: Connection, trader: Keypair, log: Logger<ILogObj>) {
    this.connector = connector
    this.web3Connection = web3Connection
    this.trader = trader
    this.log = log    
    this.walletBalance = new Map<string, Balance>
    this.totalBalance = new Map<string, Balance>
  }

  updateBalance = async() => {

    // Balance in Contract
    this.contractBalances = await this.connector.getBalanceInContract()
   
    // Balance on Chain
    this.solBalance = await this.web3Connection.getBalance(this.trader.publicKey) / LAMPORTS_PER_SOL
   
    // Token accounts
    const accountsFilter: TokenAccountsFilter = {
      programId: TOKEN_PROGRAM_ID // NOTE: Theres token-2022 as well
    }

    try {
      const accountTokenBalances = await this.web3Connection.getParsedTokenAccountsByOwner(this.trader.publicKey, accountsFilter)

      //empty our wallet balance
      //feels wrong but we dont want stale data
      this.walletBalance.clear()
      this.totalBalance.clear()

      for(const balance of accountTokenBalances.value) {
        
        const tokenBalance = balance.account.data.parsed.info.tokenAmount.uiAmount
        const rawAmount = +balance.account.data.parsed.info.tokenAmount.amount
        const decimals = balance.account.data.parsed.info.tokenAmount.decimals
       
        const tokenMint = balance.account.data.parsed.info.mint
        // TODO: Need to check for wrapped SOL to combine with SOL balance 
        if(tokenMint === 'So11111111111111111111111111111111111111112'){
          // STUB this is technically SOL.
        }
        const tokenInfo = await masterConfig[MODE].tokens.filter((token: TokenConfig) => {
          if(token.mint == tokenMint){
            return token         
          }
        })

        const atb: Balance = {
          asset: tokenInfo[0].symbol,
          amount: tokenBalance,
          free: tokenBalance,
          locked: 0          
        }
        this.walletBalance.set(atb.asset, atb)
        this.totalBalance.set(atb.asset, atb)
        //this.log.info(accountTokenBalance)
      }
    } catch (error){
      this.log.error(error)
    }

    //now add all the balances in the contracts to the total balance
    let baseAsset = this.contractBalances.base.asset
    let base : Balance = { 
      asset:baseAsset,
      amount: 0, 
      free: 0,
      locked:0 
    }
    if (this.walletBalance.has(baseAsset)) {
      base = this.walletBalance.get(baseAsset) as Balance
    }
    base.amount += this.contractBalances.base.amount
    base.free += this.contractBalances.base.free
    base.amount += this.contractBalances.base.locked
    base.locked = this.contractBalances.base.locked
    this.totalBalance.set(baseAsset, base)

    let quoteAsset = this.contractBalances.quote.asset
    let quote : Balance = { 
      asset:quoteAsset,
      amount: 0, 
      free: 0,
      locked:0 
    }
    if (this.walletBalance.has(quoteAsset)) {
      quote = this.walletBalance.get(quoteAsset) as Balance
    }
    quote.amount += this.contractBalances.quote.amount
    quote.free += this.contractBalances.quote.free
    quote.amount += this.contractBalances.quote.locked
    quote.locked = this.contractBalances.quote.locked
    this.totalBalance.set(quoteAsset, quote)

  }

  //returns the balance or an empty balance object.  
  //Maybe should be undefined?  or is 0 balance the same?
  getWalletBalance( asset: string ): Balance {
    if (this.walletBalance.has(asset)) {
      return this.walletBalance.get(asset) as Balance
    }
    let b = {} as Balance
    return b
  }

  getTotalBalance( asset: string ): Balance {
    if (this.totalBalance.has(asset)) {
      return this.totalBalance.get(asset) as Balance
    }
    let b = {} as Balance
    return b
  }

  getAllBalances(): Map<string, Balance> {
    return this.totalBalance
  }

  getContractBalance() : ContractBalance {
    return this.contractBalances
  }

  // TODO: Pass contract and understand base and quote
  getBalanceForMarket(): ContractBalance {
    const balance: ContractBalance = {
      // @ts-ignore
      base: this.totalBalance.get('SOL'),
      // @ts-ignore
      quote: this.totalBalance.get('USDC'),
      trading_pair: 'SOL/USDC',
      market: 'CS2H8nbAVVEUHWPF5extCSymqheQdkd4d7thik6eet9N'
    }
    return balance
  }

  getSolBalance() : number {
    return this.solBalance
  }

  dumpBalances() {
    this.log.debug('Contract Balances - ', this.contractBalances )
    this.log.debug('Wallet Balances - ', this.walletBalance)
    this.log.debug('Sol Balance - ', this.solBalance)
    
  }
}