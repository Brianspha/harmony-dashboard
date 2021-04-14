import Vue from 'vue'
import hmy from './hmy.js'
import axios from 'axios'
import { ExportToCsv } from 'export-to-csv'
import JSZip from 'jszip'
const { Parser } = require('json2csv')
import { saveAs } from 'file-saver'
import swal from 'sweetalert2'

import {
  BASE_HRC20URL,
  HRC20_HOLDERURL,
  ONE_HOLDERURL,
  EXPLORER_BACKEND_URL,
} from './globalConfig.js'
import service from './service'

window.hmy = hmy
const HRC20_ABI = require('./HRC20_ABI.json')
const HRC721_ABI = require('./hrc721ABI.json')
const options = {
  //@dev options for creating a CSV file
  fieldSeparator: ',',
  quoteStrings: '"',
  decimalSeparator: '.',
  showLabels: true,
  showTitle: true,
  title: 'Transactions',
  useTextFile: false,
  useBom: true,
  useKeysAsHeaders: true,
  // headers: ['Column 1', 'Column 2', etc...] <-- Won't work with useKeysAsHeaders present!
}
const HRC20_LIST = []

const Limit = 10

function postprocessBlocks(items) {
  return items
    .sort((a, b) => (Number(a.timestamp) > Number(b.timestamp) ? -1 : 1))
    .slice(0, Limit)
}

function postprocessTxs(items) {
  return items
    .sort((a, b) => (Number(a.timestamp) > Number(b.timestamp) ? -1 : 1))
    .slice(0, Limit)
}

async function hrc20TxsFilter(items, isHrc20, exist) {
  let retTxs = []
  let txs = items.sort((a, b) =>
    Number(a.timestamp) > Number(b.timestamp) ? -1 : 1
  )
  for (let i in txs) {
    let tx = txs[i]
    if (isHrc20(tx.to.bech32) && !exist(tx.id)) {
      if (tx.input == undefined)
        tx.input = (
          await hmy.hmySDK.blockchain.Transaction.getTransactionByHash(tx.id)
        ).result.input
      retTxs.push(tx)
    }
  }
  return retTxs.slice(0, Limit)
}

function getTotalBlockLatency(latencies) {
  latencies = latencies.filter(x => isFinite(x))
  if (!latencies.length) return NaN

  return (
    latencies.reduce((memo, latency) => memo + latency, 0) / latencies.length
  )
}

export const HRC20LIST_URL = `${EXPLORER_BACKEND_URL}/hrc20-token-list`
export const HRC721LIST_URL = `${EXPLORER_BACKEND_URL}/hrc721-token-list`

export function fetchHrc20List(url) {
  return axios.get(url).then(rez => {
    const tokenList = rez.data.map(o => ({
      ...o,
      address: o.contractAddress,
      decimals: +o.decimals,
      symbol: o.symbol || o.name,
      description: { en: '' },
      website: '',
    }))

    return tokenList
  })
}

let Hrc20Address = {}
HRC20_LIST.map(hrc20 => (Hrc20Address[hrc20.address] = hrc20))

let store = {
  data: {
    hrc721Headers: ['#', 'Token', 'Symbol', 'Address', 'Total Supply'],
    hrc721Data: [],
    hrc720Data: [],
    displayAddressETH: false,
    shards: {},
    shardsValidators: [],
    blocks: [],
    txs: [],
    stakingTxs: [],
    pendingTxs: [],
    hrc20Txs: [],
    hrc721: [],
    hrc20TxsCount: 0,
    blockCount: 0,
    txCount: 0,
    stakingTxCount: 0,
    pendingTxsCount: 0,
    nodeCount: 0,
    lastUpdateTime: 0,
    Hrc20Address,
    HRC20_ABI,
    HRC721_ABI,
    hmy,
    HRC20_HOLDERURL,
    ONE_HOLDERURL,
    isCreatingZip: false,
    showError: false,
  },
  showError(message) {
    swal.fire({
      title: 'Transaction Data',
      text: message,
      icon: 'error',
      confirmButtonText: 'Close',
    })
  },
  zip(transactionTypes, address) {
    console.log('zipping transaction type: ', transactionTypes)
    store.data.isCreatingZip = true

    try {
      var data =
        transactionTypes === 'HRC20' ? store.data.hrc20Txs : store.data.hrc721
      data = data.filter(transaction => {
        console.log(
          'transaction.authorAddress === address: ',
          transaction.authorAddress === address
        )
        return transaction.authorAddress === address
      })
      if (data.length === 0) {
        store.data.isCreatingZip = false
        store.showError('No transaction data found for this address!')
        return
      }
      var headings = Object.keys(data[0])
      console.log('headings: ', headings)
      const parser = new Parser({
        fields: headings,
      })
      console.log('filtered for user transactions: ', data)
      const csv = parser.parse(data)
      store.downloadCSV(csv, transactionTypes)
      console.log('csv file: ', csv)
    } catch (err) {
      console.error(err)
    }
  },
  downloadCSV(data, transactionTypes) {
    var currentdate = new Date()
    var zip = new JSZip()
    var date =
      currentdate.getDate() +
      '/' +
      (currentdate.getMonth() + 1) +
      '/' +
      currentdate.getFullYear() +
      ' @ ' +
      currentdate.getHours() +
      ':' +
      currentdate.getMinutes() +
      ':' +
      currentdate.getSeconds()
    zip.file(date + '.csv', data)

    zip.generateAsync({ type: 'uint8array' }).then(function(content) {
      // see FileSaver.js
      console.log('results: ', content)
      saveAs(
        new Blob([content], { type: 'application/zip' }),
        transactionTypes + '.zip'
      )
      store.data.isCreatingZip = false
    })
  },
  changeDisplayAddressETH(val) {
    this.data.displayAddressETH =
      val !== undefined ? val : !this.displayAddressETH
    return this.data.displayAddressETH
  },
  update(data) {
    this.updateShards(data.shards)
    this.updateGlobalData()
  },
  async updateValidtors() {
    for (let i = 0; i < 4; i++) {
      console.log('index in updateValidators: ', i)
      let shardi = await hmy.hmySDK.blockchain.Staking.getValidators(i)
      console.log('shardi: ', shardi)
      if (shardi.hasOwnProperty('result')) {
        //@dev protect against where the response doesnt return any validators
        this.data.shardsValidators.push(shardi.result.validators)
      }
    }
  },
  updateHrc20List() {
    fetchHrc20List(HRC20LIST_URL).then(harc20list =>
      harc20list.map(hrc20 =>
        Vue.set(this.data.Hrc20Address, hrc20.address, {
          ...hrc20,
          logo: false, //`${BASE_HRC20URL}/HRC20/${hrc20.address}.png`,
        })
      )
    )
  },
  updateHrc721List() {
    axios.get(HRC721LIST_URL).then(({ data }) => {
      this.data.hrc721.length = 0
      this.data.hrc721.push(...data)
    })
  },
  updateShards(shards) {
    if (shards) {
      Object.values(shards).forEach(this.updateShard.bind(this))
    }
  },
  updateShard(shard) {
    let shardData = this.data.shards[shard.id]
    if (!shardData) {
      Vue.set(this.data.shards, shard.id, shard)
      shardData = this.data.shards[shard.id]
      shardData.blocks = shardData.blocks.slice(0, Limit)
      shardData.txs = shardData.txs.slice(0, Limit)
      shardData.stakingTxs = shardData.stakingTxs.slice(0, Limit)
      return
    }
    // don't add blocks that are already in latestBlocks
    let blockMap = {}
    shardData.blocks.forEach(b => (blockMap[b.id] = b))
    shard.blocks.forEach(b => (blockMap[b.id] = b))
    shardData.blocks = postprocessBlocks(Object.values(blockMap))

    // don't add txs that are already in latestTxs
    let txMap = {}
    shardData.txs.forEach(t => (txMap[t.id] = t))
    shard.txs.forEach(t => (txMap[t.id] = t))
    shardData.txs = postprocessTxs(Object.values(txMap))

    // don't add txs that are already in latestTxs
    let stakingTxMap = {}
    shardData.stakingTxs.forEach(t => (stakingTxMap[t.id] = t))
    shard.stakingTxs.forEach(t => (stakingTxMap[t.id] = t))
    shardData.stakingTxs = postprocessTxs(Object.values(stakingTxMap))

    shardData.blockCount = shard.blockCount
    shardData.nodeCount = shard.nodeCount
    shardData.lastUpdateTime = shard.lastUpdateTime
    shardData.txCount = shard.txCount
    shardData.stakingTxCount = shard.stakingTxCount
  },
  updateGlobalData() {
    this.data.blocks = postprocessBlocks(
      Object.values(this.data.shards).reduce(
        (memo, shard) => memo.concat(shard.blocks),
        []
      )
    )
    this.data.txs = postprocessTxs(
      Object.values(this.data.shards).reduce(
        (memo, shard) => memo.concat(shard.txs),
        []
      )
    )
    this.updateHrc20List()
    this.updateHrc721List()
    service.getHrc20TxsLatest({ pageSize: 10, pageIndex: 0 }).then(result => {
      this.data.hrc20Txs = result.txs
      this.data.hrc20TxsCount = result.total
    })
    this.data.stakingTxs = postprocessTxs(
      Object.values(this.data.shards).reduce(
        (memo, shard) => memo.concat(shard.stakingTxs),
        []
      )
    )
    this.data.blockCount = Object.values(this.data.shards).reduce(
      (memo, shard) => memo + shard.blockCount,
      0
    )
    this.data.txCount = Object.values(this.data.shards).reduce(
      (memo, shard) => memo + shard.txCount,
      0
    )
    this.data.stakingTxCount = Object.values(this.data.shards).reduce(
      (memo, shard) => memo + shard.stakingTxCount,
      0
    )
    this.data.nodeCount = Object.values(this.data.shards).reduce(
      (memo, shard) => memo + shard.nodeCount,
      0
    )
    this.data.shardCount = Object.keys(this.data.shards).length
    this.data.blockLatency = getTotalBlockLatency(
      Object.values(this.data.shards).map(s => s.blockLatency)
    )
    this.data.lastUpdateTime = Math.max(
      ...Object.values(this.data.shards)
        .map(s => s.lastUpdateTime)
        .filter(x => isFinite(x))
    )
  },
  updatePendingTransactions(txs, shardID) {
    let pendingTxs = this.data.pendingTxs

    if (pendingTxs[shardID]) {
      this.data.pendingTxsCount -= pendingTxs[shardID].length
    }
    this.data.pendingTxs = null

    pendingTxs[shardID] = txs

    this.data.pendingTxs = pendingTxs
    this.data.pendingTxsCount += pendingTxs[shardID].length
  },
  reset() {
    this.data.blocks = []
    this.data.txs = []
    this.data.stakingTxs = []
    this.data.pendingTxs = []
    this.data.blockCount = 0
    this.data.txCount = 0
    this.data.stakingTxCount = 0
    this.data.nodeCount = 0
    this.data.nodes = {}
    this.data.shardCount = 0
  },
}

store.updateValidtors()

Vue.prototype.$store = store

export default store
