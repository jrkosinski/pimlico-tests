import "dotenv/config"
import { getAccountNonce, createSmartAccountClient, ENTRYPOINT_ADDRESS_V07, ENTRYPOINT_ADDRESS_V06, bundlerActions, getSenderAddress, signUserOperationHashWithECDSA, UserOperation } from "permissionless"
import { Address, Client, concat, concatHex, createClient, createPublicClient, encodeFunctionData, encodePacked, getContractAddress, Hash, hexToBigInt, http, keccak256, PrivateKeyAccount, zeroAddress } from "viem"
import { sepolia } from "viem/chains"
import { createPimlicoBundlerClient, createPimlicoPaymasterClient } from "permissionless/clients/pimlico";
import { privateKeyToSimpleSmartAccount, privateKeyToSafeSmartAccount } from "permissionless/accounts";
import { pimlicoBundlerActions, pimlicoPaymasterActions } from "permissionless/actions/pimlico";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export const apiKey = "dfc7d1e4-804b-41dc-9be5-57084b57ea73";
export const paymasterUrl = `https://api.pimlico.io/v2/sepolia/rpc?apikey=${apiKey}`;

export const privateKey = "0xb273a4b1cfde72170a1ff120127e9ff1d4304328b6ed055b85f140190968682b";

export const publicClient = createPublicClient({
    transport: http("https://rpc.ankr.com/eth_sepolia"),
});

export const signer = privateKeyToAccount(privateKey as Hash);

export const safeConstAddresses = {
    sepolia: {
        ADD_MODULE_LIB_ADDRESS: '0x8EcD4ec46D4D2a6B64fE960B3D64e8B94B2234eb',
        SAFE_4337_MODULE_ADDRESS: '0xa581c4A4DB7175302464fF3C06380BC3270b4037',
        SAFE_PROXY_FACTORY_ADDRESS: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
        SAFE_SINGLETON_ADDRESS: '0x41675C099F32341bf84BFc5382aF534df5C7461a',
        SAFE_MULTISEND_ADDRESS: '0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526',
        ERC20_PAYMASTER_ADDRESS: "0x0000000000325602a77416A16136FDafd04b299f",
        USDC_TOKEN_ADDRESS: "0x46E34764D5288c6047aeC37E163F8C782a0b3C75",
    }
}

export const enableModuleCallData = (safe4337ModuleAddress: `0x${string}`) => {
    return encodeFunctionData({
        abi: [
            {
                inputs: [
                    {
                        internalType: 'address[]',
                        name: 'modules',
                        type: 'address[]'
                    }
                ],
                name: 'enableModules',
                outputs: [],
                stateMutability: 'nonpayable',
                type: 'function'
            }
        ],
        functionName: 'enableModules',
        args: [[safe4337ModuleAddress]]
    })
}

type InternalTx = {
    to: Address
    data: `0x${string}`
    value: bigint
    operation: 0 | 1
}

export const encodeMultiSend = (txs: InternalTx[]): `0x${string}` => {
    const data: `0x${string}` = `0x${txs.map((tx) => encodeInternalTransaction(tx)).join('')}`

    return encodeFunctionData({
        abi: [
            {
                inputs: [{ internalType: 'bytes', name: 'transactions', type: 'bytes' }],
                name: 'multiSend',
                outputs: [],
                stateMutability: 'payable',
                type: 'function'
            }
        ],
        functionName: 'multiSend',
        args: [data]
    })
}

export const encodeInternalTransaction = (tx: InternalTx): string => {
    const encoded = encodePacked(
        ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
        [tx.operation, tx.to, tx.value, BigInt(tx.data.slice(2).length / 2), tx.data],
    )
    return encoded.slice(2)
}

const EIP712_SAFE_OPERATION_TYPE = {
    SafeOp: [
        { type: 'address', name: 'safe' },
        { type: 'uint256', name: 'nonce' },
        { type: 'bytes', name: 'initCode' },
        { type: 'bytes', name: 'callData' },
        { type: 'uint256', name: 'callGasLimit' },
        { type: 'uint256', name: 'verificationGasLimit' },
        { type: 'uint256', name: 'preVerificationGas' },
        { type: 'uint256', name: 'maxFeePerGas' },
        { type: 'uint256', name: 'maxPriorityFeePerGas' },
        { type: 'bytes', name: 'paymasterAndData' },
        { type: 'uint48', name: 'validAfter' },
        { type: 'uint48', name: 'validUntil' },
        { type: 'address', name: 'entryPoint' }
    ]
}

export const signUserOperation = async (
    userOperation: UserOperation,
    signer: PrivateKeyAccount,
    chainId: any,
    safe4337ModuleAddress: any
) => {
    const signatures = [
        {
            signer: signer.address,
            data: await signer.signTypedData({
                domain: {
                    chainId,
                    verifyingContract: safe4337ModuleAddress
                },
                types: EIP712_SAFE_OPERATION_TYPE,
                primaryType: 'SafeOp',
                message: {
                    safe: userOperation.sender,
                    nonce: userOperation.nonce,
                    initCode: userOperation.initCode,
                    callData: userOperation.callData,
                    callGasLimit: userOperation.callGasLimit,
                    verificationGasLimit: userOperation.verificationGasLimit,
                    preVerificationGas: userOperation.preVerificationGas,
                    maxFeePerGas: userOperation.maxFeePerGas,
                    maxPriorityFeePerGas: userOperation.maxPriorityFeePerGas,
                    paymasterAndData: userOperation.paymasterAndData,
                    validAfter: '0x000000000000',
                    validUntil: '0x000000000000',
                    entryPoint: ENTRYPOINT_ADDRESS_V06
                }
            })
        }
    ]
    signatures.sort((left, right) => left.signer.toLowerCase().localeCompare(right.signer.toLowerCase()))
    let signatureBytes: Address = '0x000000000000000000000000'
    for (const sig of signatures) {
        signatureBytes += sig.data.slice(2)
    }
    return signatureBytes
}

export const generateApproveCallData = (erc20TokenAddress: Address, paymasterAddress: Address) => {
    const approveData = encodeFunctionData({
        abi: [
            {
                inputs: [
                    { name: "_spender", type: "address" },
                    { name: "_value", type: "uint256" },
                ],
                name: "approve",
                outputs: [{ name: "", type: "bool" }],
                payable: false,
                stateMutability: "nonpayable",
                type: "function",
            },
        ],
        args: [paymasterAddress, 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn],
    })

    // GENERATE THE CALLDATA TO APPROVE THE USDC
    const to = erc20TokenAddress
    const value = 0n
    const data = approveData

    const callData = encodeFunctionData({
        abi: [
            {
                inputs: [
                    { name: "dest", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "func", type: "bytes" },
                ],
                name: "execute",
                outputs: [],
                stateMutability: "nonpayable",
                type: "function",
            },
        ],
        args: [to, value, data],
    })

    return callData
}

export const getInitializerCode = async ({
    owner,
    addModuleLibAddress,
    safe4337ModuleAddress,
    multiSendAddress,
    erc20TokenAddress,
    paymasterAddress
}: {
    owner: Address
    addModuleLibAddress: Address
    safe4337ModuleAddress: Address
    multiSendAddress: Address
    erc20TokenAddress: Address
    paymasterAddress: Address
}) => {
    const setupTxs: InternalTx[] = [
        {
            to: addModuleLibAddress,
            data: enableModuleCallData(safe4337ModuleAddress),
            value: 0n,
            operation: 1 // 1 = DelegateCall required for enabling the module
        },
    ]

    if (erc20TokenAddress != zeroAddress && paymasterAddress != zeroAddress) {
        setupTxs.push({
            to: erc20TokenAddress,
            data: generateApproveCallData(erc20TokenAddress, paymasterAddress),
            value: 0n,
            operation: 0 // 0 = Call
        })
    }

    const encodeMultiSend = (txs: InternalTx[]): `0x${string}` => {
        const data: `0x${string}` = `0x${txs.map((tx) => encodeInternalTransaction(tx)).join('')}`

        return encodeFunctionData({
            abi: [
                {
                    inputs: [{ internalType: 'bytes', name: 'transactions', type: 'bytes' }],
                    name: 'multiSend',
                    outputs: [],
                    stateMutability: 'payable',
                    type: 'function'
                }
            ],
            functionName: 'multiSend',
            args: [data]
        })
    }

    const multiSendCallData = encodeMultiSend(setupTxs);

    return encodeFunctionData({
        abi: [
            {
                inputs: [
                    {
                        internalType: 'address[]',
                        name: '_owners',
                        type: 'address[]'
                    },
                    {
                        internalType: 'uint256',
                        name: '_threshold',
                        type: 'uint256'
                    },
                    {
                        internalType: 'address',
                        name: 'to',
                        type: 'address'
                    },
                    {
                        internalType: 'bytes',
                        name: 'data',
                        type: 'bytes'
                    },
                    {
                        internalType: 'address',
                        name: 'fallbackHandler',
                        type: 'address'
                    },
                    {
                        internalType: 'address',
                        name: 'paymentToken',
                        type: 'address'
                    },
                    {
                        internalType: 'uint256',
                        name: 'payment',
                        type: 'uint256'
                    },
                    {
                        internalType: 'address payable',
                        name: 'paymentReceiver',
                        type: 'address'
                    },
                ],
                name: 'setup',
                outputs: [],
                stateMutability: 'nonpayable',
                type: 'function'
            }
        ],
        functionName: 'setup',
        args: [[owner], 1n, multiSendAddress, multiSendCallData, safe4337ModuleAddress, zeroAddress, 0n, zeroAddress]
    })
}

export const getAccountInitCode = async ({
    owner,
    addModuleLibAddress,
    safe4337ModuleAddress,
    safeProxyFactoryAddress,
    safeSingletonAddress,
    saltNonce = 0n,
    multiSendAddress,
    erc20TokenAddress,
    paymasterAddress
}: {
    owner: Address
    addModuleLibAddress: Address
    safe4337ModuleAddress: Address
    safeProxyFactoryAddress: Address
    safeSingletonAddress: Address
    saltNonce?: bigint
    multiSendAddress: Address
    erc20TokenAddress: Address
    paymasterAddress: Address
}): Promise<Hex> => {
    if (!owner) throw new Error('Owner account not found')

    console.log("erc20 ", erc20TokenAddress);
    console.log("paymaster ", paymasterAddress);

    const initializer = await getInitializerCode({
        owner,
        addModuleLibAddress,
        safe4337ModuleAddress,
        multiSendAddress,
        erc20TokenAddress,
        paymasterAddress
    })

    const initCodeCallData = encodeFunctionData({
        abi: [
            {
                inputs: [
                    {
                        internalType: 'address',
                        name: '_singleton',
                        type: 'address'
                    },
                    {
                        internalType: 'bytes',
                        name: 'initializer',
                        type: 'bytes'
                    },
                    {
                        internalType: 'uint256',
                        name: 'saltNonce',
                        type: 'uint256'
                    },
                ],
                name: 'createProxyWithNonce',
                outputs: [
                    {
                        internalType: 'contract SafeProxy',
                        name: 'proxy',
                        type: 'address'
                    },
                ],
                stateMutability: 'nonpayable',
                type: 'function'
            }
        ],
        functionName: 'createProxyWithNonce',
        args: [safeSingletonAddress, initializer, saltNonce]
    })

    return concatHex([safeProxyFactoryAddress, initCodeCallData])
}

export const getAccountAddress = async ({
    client,
    owner,
    addModuleLibAddress,
    safe4337ModuleAddress,
    safeProxyFactoryAddress,
    safeSingletonAddress,
    saltNonce = 0n,
    multiSendAddress,
    erc20TokenAddress,
    paymasterAddress
}: {
    client: PublicClient
    owner: Address
    addModuleLibAddress: Address
    safe4337ModuleAddress: Address
    safeProxyFactoryAddress: Address
    safeSingletonAddress: Address
    saltNonce?: bigint
    multiSendAddress: Address
    erc20TokenAddress: Address
    paymasterAddress: Address
}): Promise<Address> => {
    const proxyCreationCode = await client.readContract({
        abi: [
            {
                inputs: [],
                name: 'proxyCreationCode',
                outputs: [
                    {
                        internalType: 'bytes',
                        name: '',
                        type: 'bytes'
                    }
                ],
                stateMutability: 'pure',
                type: 'function'
            }
        ],
        address: safeProxyFactoryAddress,
        functionName: 'proxyCreationCode'
    })

    const deploymentCode = encodePacked(
        ['bytes', 'uint256'],
        [proxyCreationCode, hexToBigInt(safeSingletonAddress)]
    );

    const initializer = await getInitializerCode({
        owner,
        addModuleLibAddress,
        safe4337ModuleAddress,
        multiSendAddress,
        erc20TokenAddress,
        paymasterAddress
    })

    const salt = keccak256(encodePacked(['bytes32', 'uint256'], [keccak256(encodePacked(['bytes'], [initializer])), saltNonce]))

    return getContractAddress({
        from: safeProxyFactoryAddress,
        salt,
        bytecode: deploymentCode,
        opcode: 'CREATE2'
    })
}

export const encodeCallData = (params: { to: Address; value: bigint; data: `0x${string}` }) => {
    return encodeFunctionData({
        abi: [
            {
                inputs: [
                    {
                        internalType: 'address',
                        name: 'to',
                        type: 'address'
                    },
                    {
                        internalType: 'uint256',
                        name: 'value',
                        type: 'uint256'
                    },
                    {
                        internalType: 'bytes',
                        name: 'data',
                        type: 'bytes'
                    },
                    {
                        internalType: 'uint8',
                        name: 'operation',
                        type: 'uint8'
                    }
                ],
                name: 'executeUserOp',
                outputs: [],
                stateMutability: 'nonpayable',
                type: 'function'
            }
        ],
        functionName: 'executeUserOp',
        args: [params.to, params.value, params.data, 0]
    })
}