// import { program } from 'commander'
import dotenv from 'dotenv'
import { Wallet } from '@ethersproject/wallet'
import { JsonRpcProvider, TransactionReceipt } from '@ethersproject/providers'
import { AddressZero } from '@ethersproject/constants'
import { getAddress } from '@ethersproject/address'
import fs from 'fs'
import deploy from './src/deploy'
import { MigrationState } from './src/migrations'
import { asciiStringToBytes32 } from './src/util/asciiStringToBytes32'
// import { version } from './package.json'

// Load environment variables from .env file
dotenv.config()

// program
//   .requiredOption('-pk, --private-key <string>', 'Private key used to deploy all contracts')
//   .requiredOption('-j, --json-rpc <url>', 'JSON RPC URL where the program should be deployed')
//   .requiredOption('-w9, --weth9-address <address>', 'Address of the WETH9 contract on this chain')
//   .requiredOption('-ncl, --native-currency-label <string>', 'Native currency label, e.g. ETH')
//   .requiredOption(
//     '-o, --owner-address <address>',
//     'Contract address that will own the deployed artifacts after the script runs'
//   )
//   .option('-s, --state <path>', 'Path to the JSON file containing the migrations state (optional)', './state.json')
//   .option('-v2, --v2-core-factory-address <address>', 'The V2 core factory address used in the swap router (optional)')
//   .option('-g, --gas-price <number>', 'The gas price to pay in GWEI for each transaction (optional)')
//   .option('-c, --confirmations <number>', 'How many confirmations to wait for after each transaction (optional)', '2')

// program.name('npx @uniswap/deploy-v3').version(version).parse(process.argv)

if(!process.env.PRIVATE_KEY) {
  console.error('Missing private key! Private key used to deploy all contracts')
  process.exit(1)
}
if(!process.env.JSON_RPC_URL) {
  console.error('Missing JSON RPC URL! JSON RPC URL where the program should be deployed')
  process.exit(1)
}
if(!process.env.WETH9_ADDRESS) {
  console.error('Missing WETH9 address! Address of the WETH9 contract on this chain')
  process.exit(1)
}
if(!process.env.NATIVE_CURRENCY_LABEL) {
  console.error('Missing native currency label! Native currency label, e.g. ETH')
  process.exit(1)
}
if(!process.env.OWNER_ADDRESS) {
  console.error('Missing owner address! Contract address that will own the deployed artifacts after the script runs')
  process.exit(1)
}
if (!/^0x[a-zA-Z0-9]{64}$/.test(process.env.PRIVATE_KEY)) {
  console.error('Invalid private key!')
  process.exit(1)
}

let url: URL
try {
  url = new URL(process.env.JSON_RPC_URL)
} catch (error) {
  console.error('Invalid JSON RPC URL', (error as Error).message)
  process.exit(1)
}

const wallet = new Wallet(process.env.PRIVATE_KEY, new JsonRpcProvider({ url: url.href }))

let gasPrice: number | undefined
try {
  gasPrice = process.env.GAS_PRICE ? parseInt(process.env.GAS_PRICE) : undefined
} catch (error) {
  console.error('Failed to parse gas price', (error as Error).message)
  process.exit(1)
}

let confirmations: number
try {
  confirmations = parseInt(process.env.CONFIRMATIONS || '2')
} catch (error) {
  console.error('Failed to parse confirmations', (error as Error).message)
  process.exit(1)
}

let nativeCurrencyLabelBytes: string
try {
  nativeCurrencyLabelBytes = asciiStringToBytes32(process.env.NATIVE_CURRENCY_LABEL)
} catch (error) {
  console.error('Invalid native currency label', (error as Error).message)
  process.exit(1)
}

let weth9Address: string
try {
  weth9Address = getAddress(process.env.WETH9_ADDRESS)
} catch (error) {
  console.error('Invalid WETH9 address', (error as Error).message)
  process.exit(1)
}

let v2CoreFactoryAddress: string
if (typeof process.env.V2_CORE_FACTORY_ADDRESS === 'undefined') {
  v2CoreFactoryAddress = AddressZero
} else {
  try {
    v2CoreFactoryAddress = getAddress(process.env.V2_CORE_FACTORY_ADDRESS)
  } catch (error) {
    console.error('Invalid V2 factory address', (error as Error).message)
    process.exit(1)
  }
}

let ownerAddress: string
try {
  ownerAddress = getAddress(process.env.OWNER_ADDRESS)
} catch (error) {
  console.error('Invalid owner address', (error as Error).message)
  process.exit(1)
}

const stateFile = process.env.STATE || './state.json'
let state: MigrationState
if (fs.existsSync(stateFile)) {
  try {
    state = JSON.parse(fs.readFileSync(stateFile, { encoding: 'utf8' }))
  } catch (error) {
    console.error('Failed to load and parse migration state file', (error as Error).message)
    process.exit(1)
  }
} else {
  state = {}
}

let finalState: MigrationState
const onStateChange = async (newState: MigrationState): Promise<void> => {
  fs.writeFileSync(stateFile, JSON.stringify(newState))
  finalState = newState
}

async function run() {
  let step = 1
  const results = []
  const generator = deploy({
    signer: wallet,
    gasPrice,
    nativeCurrencyLabelBytes,
    v2CoreFactoryAddress,
    ownerAddress,
    weth9Address,
    initialState: state,
    onStateChange,
  })

  for await (const result of generator) {
    console.log(`Step ${step++} complete`, result)
    results.push(result)

    // wait 15 minutes for any transactions sent in the step
    await Promise.all(
      result.map(
        (stepResult): Promise<TransactionReceipt | true> => {
          if (stepResult.hash) {
            return wallet.provider.waitForTransaction(stepResult.hash, confirmations, /* 15 minutes */ 1000 * 60 * 15)
          } else {
            return Promise.resolve(true)
          }
        }
      )
    )
  }

  return results
}

run()
  .then((results) => {
    console.log('Deployment succeeded')
    console.log(JSON.stringify(results))
    console.log('Final state')
    console.log(JSON.stringify(finalState))
    process.exit(0)
  })
  .catch((error) => {
    console.error('Deployment failed', error)
    console.log('Final state')
    console.log(JSON.stringify(finalState))
    process.exit(1)
  })
