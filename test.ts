import "dotenv/config"
import { getAccountNonce, createSmartAccountClient, ENTRYPOINT_ADDRESS_V07, ENTRYPOINT_ADDRESS_V06, bundlerActions, getSenderAddress, signUserOperationHashWithECDSA, UserOperation } from "permissionless"
import { Address, Client, concat, createClient, createPublicClient, encodeFunctionData, encodePacked, Hash, hexToBigInt, http, PrivateKeyAccount, zeroAddress } from "viem"
//import { generatePrivateKey, privateKeyToAccount, signMessage } from "viem/accounts"
import { sepolia, polygonMumbai } from "viem/chains"
import { createPimlicoBundlerClient, createPimlicoPaymasterClient } from "permissionless/clients/pimlico";
import { privateKeyToSimpleSmartAccount, privateKeyToSafeSmartAccount } from "permissionless/accounts";
import { pimlicoBundlerActions, pimlicoPaymasterActions } from "permissionless/actions/pimlico";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const apiKey = "dfc7d1e4-804b-41dc-9be5-57084b57ea73";
const paymasterUrl = `https://api.pimlico.io/v2/sepolia/rpc?apikey=${apiKey}`;

const privateKey = "0xb273a4b1cfde72170a1ff120127e9ff1d4304328b6ed055b85f140190968682b";

const publicClient = createPublicClient({
    transport: http("https://rpc.ankr.com/eth_sepolia"),
});

export async function gaslessTransactionsTest() {

    const paymasterClient = createPimlicoPaymasterClient({
        transport: http(paymasterUrl),
        entryPoint: ENTRYPOINT_ADDRESS_V07,
    });

    const account = await privateKeyToSimpleSmartAccount(publicClient, {
        privateKey,
        entryPoint: ENTRYPOINT_ADDRESS_V07, // global entrypoint
        factoryAddress: "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985",
    });



    const bundlerUrl = `https://api.pimlico.io/v2/sepolia/rpc?apikey=${apiKey}`

    const bundlerClient = createPimlicoBundlerClient({
        transport: http(bundlerUrl),
        entryPoint: ENTRYPOINT_ADDRESS_V07,
    });

    const smartAccountClient = createSmartAccountClient({
        account,
        entryPoint: ENTRYPOINT_ADDRESS_V07,
        chain: sepolia,
        bundlerTransport: http(bundlerUrl),
        middleware: {
            gasPrice: async () => {
                return (await bundlerClient.getUserOperationGasPrice()).fast
            },
            sponsorUserOperation: paymasterClient.sponsorUserOperation,
        },
    });

    const txHash = await smartAccountClient.sendTransaction({
        to: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        value: 0n,
        data: "0x1234",
    });

    console.log(`User operation included: https://sepolia.etherscan.io/tx/${txHash}`);

    console.log(`Smart account address: https://sepolia.etherscan.io/address/${account.address}`);
    //console.log(paymasterClient);
    console.log(smartAccountClient.account.address);
}

export async function sendUserOperationsWithPaymasterTest() {
    const bundlerClient = createClient({
        transport: http(paymasterUrl),
        chain: sepolia,
    }).extend(bundlerActions(ENTRYPOINT_ADDRESS_V07)
    ).extend(pimlicoBundlerActions(ENTRYPOINT_ADDRESS_V07))

    const paymasterClient = createClient({
        transport: http(paymasterUrl),
        chain: sepolia,
    }).extend(pimlicoPaymasterActions(ENTRYPOINT_ADDRESS_V07));

    console.log(paymasterClient);

    const SIMPLE_ACCOUNT_FACTORY_ADDRESS = "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985";

    const ownerPrivateKey = generatePrivateKey();
    const owner = privateKeyToAccount(ownerPrivateKey);

    console.log("Generated wallet with private key:", ownerPrivateKey);

    const factory = SIMPLE_ACCOUNT_FACTORY_ADDRESS
    const factoryData = encodeFunctionData({
        abi: [
            {
                inputs: [
                    { name: "owner", type: "address" },
                    { name: "salt", type: "uint256" },
                ],
                name: "createAccount",
                outputs: [{ name: "ret", type: "address" }],
                stateMutability: "nonpayable",
                type: "function",
            },
        ],
        args: [owner.address, 0n],
    });

    console.log("Generated factoryData:", factoryData);

    const senderAddress = await getSenderAddress(publicClient, {
        factory,
        factoryData,
        entryPoint: ENTRYPOINT_ADDRESS_V07,
    });
    console.log("Calculated sender address:", senderAddress);

    const to = "0x5728C7b8b448332Acda43369afa3a2c25C947D43";
    const value = 0;
    const data = "0x68656c6c";

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
    });

    console.log("Generated callData:", callData);

    //CREATE USER OPERATIONS 
    const gasPrice = await bundlerClient.getUserOperationGasPrice();

    const userOperation = {
        sender: senderAddress,
        nonce: 0n,
        factory: factory as Address,
        factoryData,
        callData,
        maxFeePerGas: gasPrice.fast.maxFeePerGas,
        maxPriorityFeePerGas: gasPrice.fast.maxPriorityFeePerGas,
        // dummy signature, needs to be there so the SimpleAccount doesn't immediately revert because of invalid signature length
        signature:
            "0xa15569dd8f8324dbeabf8073fdec36d4b754f53ce5901e283c6de79af177dc94557fa3c9922cd7af2a96ca94402d35c39f266925ee6407aeb32b31d76978d4ba1c" as Hex,
    };

    //GET SPONSORSHIP FROM PAYMASTER
    console.log("getting sponsorship...");
    const sponsorUserOperationResult = await paymasterClient.sponsorUserOperation({
        userOperation,
    })

    console.log("getting sponsorship...");
    const sponsoredUserOperation: UserOperation<"v0.7"> = {
        ...userOperation,
        ...sponsorUserOperationResult,
    };

    console.log("Received paymaster sponsor result:", sponsorUserOperationResult);

    //generate signature
    const signature = await signUserOperationHashWithECDSA({
        account: owner,
        userOperation: sponsoredUserOperation,
        chainId: sepolia.id,
        entryPoint: ENTRYPOINT_ADDRESS_V07,
    });
    sponsoredUserOperation.signature = signature;

    console.log("Generated signature:", signature);

    //submit the user op to be bundled...
    const userOperationHash = await bundlerClient.sendUserOperation({
        userOperation: sponsoredUserOperation,
    })

    console.log("Received User Operation hash:", userOperationHash)

    // let's also wait for the userOperation to be included, by continually querying for the receipts
    console.log("Querying for receipts...")
    const receipt = await bundlerClient.waitForUserOperationReceipt({
        hash: userOperationHash,
    })
    const txHash = receipt.receipt.transactionHash;

    console.log(`UserOperation included: https://sepolia.etherscan.io/tx/${txHash}`);
}

export async function sendUserOperationsWithErc20PaymasterTest() {
    const entryPointAddr = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
    const accountFactoryAddr = "0x9406Cc6185a346906296840746125a0E44976454";

    const signer = privateKeyToAccount(privateKey as Hash);

    const bundlerClient = createClient({
        //using v1 of the API
        transport: http(`https://api.pimlico.io/v1/sepolia/rpc?apikey=${apiKey}`),
        chain: sepolia,
    }).extend(bundlerActions(ENTRYPOINT_ADDRESS_V06)
    ).extend(pimlicoBundlerActions(ENTRYPOINT_ADDRESS_V06));

    const paymasterClient = createClient({
        //using v2 of the API
        transport: http(`https://api.pimlico.io/v2/sepolia/rpc?apikey=${apiKey}`),
        chain: sepolia,
    }).extend(pimlicoPaymasterActions(ENTRYPOINT_ADDRESS_V06));

    const publicClient = createPublicClient({
        transport: http("https://sepolia.rpc.thirdweb.com"),
        chain: sepolia,
    });

    const initCode: `0x${string}` | Uint8Array | undefined = concat([
        accountFactoryAddr,
        encodeFunctionData({
            abi: [
                {
                    inputs: [
                        { name: "owner", type: "address" },
                        { name: "salt", type: "uint256" },
                    ],
                    name: "createAccount",
                    outputs: [{ name: "ret", type: "address" }],
                    stateMutability: "nonpayable",
                    type: "function",
                },
            ],
            args: [signer.address, 0n],
        }),
    ]);

    const senderAddress = await getSenderAddress(publicClient, {
        initCode,
        entryPoint: entryPointAddr,
    })
    console.log("Counterfactual sender address:", senderAddress);


    const submitUserOperation = async (userOperation: UserOperation<"v0.6">) => {
        const userOperationHash = await bundlerClient.sendUserOperation({
            userOperation,
        })
        console.log(`UserOperation submitted. Hash: ${userOperationHash}`)

        //TODO: should be its own function (is repeated several times)
        console.log("Querying for receipts...")
        const receipt = await bundlerClient.waitForUserOperationReceipt({
            hash: userOperationHash,
        })
        console.log(`Receipt found... transaction hash: ${receipt.receipt.transactionHash}`)
    }

    // https://docs.pimlico.io/paymaster/erc20-paymaster/contract-addresses
    const erc20PaymasterAddress = "0x0000000000325602a77416A16136FDafd04b299f"
    //const usdcTokenAddress = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" // USDC on sepolia
    const usdcTokenAddress = "0x46E34764D5288c6047aeC37E163F8C782a0b3C75"; //my own token


    const senderUsdcBalance = await publicClient.readContract({
        abi: [
            {
                inputs: [{ name: "_owner", type: "address" }],
                name: "balanceOf",
                outputs: [{ name: "balance", type: "uint256" }],
                type: "function",
                stateMutability: "view",
            },
        ],
        address: usdcTokenAddress,
        functionName: "balanceOf",
        args: [senderAddress],
    });

    console.log("sender address:", senderAddress);
    console.log("senderUsdcBalance:", senderUsdcBalance);

    if (senderUsdcBalance < 1_000_000n) {
        throw new Error(
            `insufficient USDC balance for counterfactual wallet address ${senderAddress}: ${Number(senderUsdcBalance) / 1000000
            } USDC, required at least 1 USDC`,
        )
    }

    const approveCallData = generateApproveCallData(usdcTokenAddress, erc20PaymasterAddress);
    console.log("approveCallData: " + approveCallData);

    // FILL OUT THE REMAINING USEROPERATION VALUES
    const gasPriceResult = await bundlerClient.getUserOperationGasPrice();

    const userOperation: Partial<UserOperation<"v0.6">> = {
        sender: senderAddress,
        nonce: 0n,
        initCode,
        callData: approveCallData,
        maxFeePerGas: gasPriceResult.fast.maxFeePerGas,
        maxPriorityFeePerGas: gasPriceResult.fast.maxPriorityFeePerGas,
        paymasterAndData: "0x",
        signature:
            "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c",
    }

    const nonce = await getAccountNonce(publicClient, {
        entryPoint: entryPointAddr,
        sender: senderAddress,
    })

    if (nonce === 0n) {
        // SPONSOR THE USEROPERATION USING THE VERIFYING PAYMASTER
        const result = await paymasterClient.sponsorUserOperation({
            userOperation: userOperation as UserOperation<"v0.6">,
        })

        userOperation.preVerificationGas = result.preVerificationGas
        userOperation.verificationGasLimit = result.verificationGasLimit
        userOperation.callGasLimit = result.callGasLimit
        userOperation.paymasterAndData = result.paymasterAndData

        // SIGN THE USER OPERATION
        const signature = await signUserOperationHashWithECDSA({
            account: signer,
            userOperation: userOperation as UserOperation<"v0.6">,
            chainId: sepolia.id,
            entryPoint: entryPointAddr,
        })

        userOperation.signature = signature
        await submitUserOperation(userOperation as UserOperation<"v0.6">)
    } else {
        console.log("Deployment UserOperation previously submitted, skipping...")
    }

    //SUBMIT THE ACTUAL OPERATION... 
    const genereteDummyCallData = () => {
        const to = "0x5728C7b8b448332Acda43369afa3a2c25C947D43"; //recipient
        const value = 0n
        const data = "0x"

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

    console.log("Sponsoring a user operation with the ERC-20 paymaster...")

    const newNonce = await getAccountNonce(publicClient, {
        entryPoint: entryPointAddr,
        sender: senderAddress,
    });

    const sponsoredUserOperation: UserOperation<"v0.6"> = {
        sender: senderAddress,
        nonce: newNonce,
        initCode: "0x",
        callData: genereteDummyCallData(),
        callGasLimit: 100_000n, // hardcode it for now at a high value
        verificationGasLimit: 500_000n, // hardcode it for now at a high value
        preVerificationGas: 50_000n, // hardcode it for now at a high value
        maxFeePerGas: gasPriceResult.fast.maxFeePerGas,
        maxPriorityFeePerGas: gasPriceResult.fast.maxPriorityFeePerGas,
        paymasterAndData: erc20PaymasterAddress, // to use the erc20 paymaster, put its address in the paymasterAndData field
        signature: "0x",
    }

    // SIGN THE USEROPERATION
    return;
    //TODO: this part down here fails with errors indicating paymaster can't handle gas fees
    sponsoredUserOperation.signature = await signUserOperationHashWithECDSA({
        account: signer,
        userOperation: sponsoredUserOperation,
        chainId: polygonMumbai.id,
        entryPoint: entryPointAddr,
    });

    await submitUserOperation(sponsoredUserOperation);
}











//generateApproveCallData
const generateApproveCallData = (erc20TokenAddress: Address, paymasterAddress: Address) => {
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

const safeConstAddresses = {
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

const enableModuleCallData = (safe4337ModuleAddress: `0x${string}`) => {
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

const encodeInternalTransaction = (tx: InternalTx): string => {
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

const signUserOperation = async (
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

const getInitializerCode = async ({
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
            data: generateApproveCallData(paymasterAddress),
            value: 0n,
            operation: 0 // 0 = Call
        })
    }

    const multiSendCallData = encodeMultisend(setupTxs)

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

async function createUserOperation(
): Promise<UserOperation> {
    const initCode = await getAccountInitCode({
        owner: signer.address,
        addModuleLibAddress: safeConstAddresses.sepolia.ADD_MODULE_LIB_ADDRESS,
        safe4337ModuleAddress: safeConstAddresses.sepolia.SAFE_4337_MODULE_ADDRESS,
        safeProxyFactoryAddress: safeConstAddresses.sepolia.SAFE_PROXY_FACTORY_ADDRESS,
        safeSingletonAddress: safeConstAddresses.sepolia.SAFE_SINGLETON_ADDRESS,
        saltNonce,
        multiSendAddress: safeConstAddresses.sepolia.SAFE_MULTISEND_ADDRESS,
        erc20TokenAddress: safeConstAddresses.sepolia.USDC_TOKEN_ADDRESS,
        paymasterAddress: safeConstAddresses.sepolia.ERC20_PAYMASTER_ADDRESS
    })

    const sponsoredUserOperation: UserOperation = {
        sender,
        nonce,
        initCode: contractCode ? '0x' : initCode,
        callData,
        callGasLimit: 1n, // All gas values will be filled by Estimation Response Data.
        verificationGasLimit: 1n,
        preVerificationGas: 1n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        paymasterAndData: safeConstAddresses.sepolia.ERC20_PAYMASTER_ADDRESS,
        signature: '0x'
    }

    return sponsoredUserOperation;
}

const getAccountAddress = async ({
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

export async function createSafeSmartAccount() {
    const bundlerUrl = `https://api.pimlico.io/v1/sepolia/rpc?apikey=${apiKey}`;
    const transportUrl = `https://api.pimlico.io/v2/gnosis/rpc?apikey=${apiKey}`;

    const bundlerClient = createClient({
        transport: http(transportUrl),
        chain: sepolia,
    }).extend(bundlerActions(ENTRYPOINT_ADDRESS_V06)
    ).extend(pimlicoBundlerActions(ENTRYPOINT_ADDRESS_V06))

    const paymasterClient = createClient({
        transport: http(transportUrl),
        chain: sepolia,
    }).extend(pimlicoPaymasterActions(ENTRYPOINT_ADDRESS_V06));

    console.log(paymasterClient);

    const signer = privateKeyToAccount(privateKey as Hash);

    console.log(signer.address);
    console.log(safeConstAddresses.sepolia.ADD_MODULE_LIB_ADDRESS);
    console.log(safeConstAddresses.sepolia.SAFE_4337_MODULE_ADDRESS);
    console.log(safeConstAddresses.sepolia.SAFE_PROXY_FACTORY_ADDRESS);
    console.log(safeConstAddresses.sepolia.SAFE_SINGLETON_ADDRESS);
    console.log(safeConstAddresses.sepolia.SAFE_MULTISEND_ADDRESS);
    console.log(safeConstAddresses.sepolia.USDC_TOKEN_ADDRESS);
    console.log(safeConstAddresses.sepolia.ERC20_PAYMASTER_ADDRESS);

    console.log(publicClient);

    //get sender
    const sender = await getAccountAddress({
        client: publicClient,
        owner: signer.address,
        addModuleLibAddress: safeConstAddresses.sepolia.ADD_MODULE_LIB_ADDRESS,
        safe4337ModuleAddress: safeConstAddresses.sepolia.SAFE_4337_MODULE_ADDRESS,
        safeProxyFactoryAddress: safeConstAddresses.sepolia.SAFE_PROXY_FACTORY_ADDRESS,
        safeSingletonAddress: safeConstAddresses.sepolia.SAFE_SINGLETON_ADDRESS,
        saltNonce: BigInt(0),
        multiSendAddress: safeConstAddresses.sepolia.SAFE_MULTISEND_ADDRESS,
        erc20TokenAddress: safeConstAddresses.sepolia.USDC_TOKEN_ADDRESS,
        paymasterAddress: safeConstAddresses.sepolia.ERC20_PAYMASTER_ADDRESS
    });

    return;
    //create user operation
    const contractCode = await publicClient.getBytecode({ address: sender })

    const userOperation: UserOperation = createUserOperation();
}

createSafeSmartAccount();