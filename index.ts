import "dotenv/config"
import { getAccountNonce, createSmartAccountClient, ENTRYPOINT_ADDRESS_V07, ENTRYPOINT_ADDRESS_V06, bundlerActions, getSenderAddress, signUserOperationHashWithECDSA } from "permissionless"
import { Address, concat, createClient, createPublicClient, encodeFunctionData, Hash, http } from "viem"
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

async function gaslessTransactionsTest() {

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

async function sendUserOperationsWithPaymasterTest() {
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

async function sendUserOperationsWithErc20PaymasterTest() 
{
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
    const usdcTokenAddress = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" // USDC on sepolia

    const approveCallData = generateApproveCallData(usdcTokenAddress, erc20PaymasterAddress);
    console.log("approveCallData: " + approveCallData);
    
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
    
    console.log("senderUsdcBalance:", senderUsdcBalance);
}

sendUserOperationsWithErc20PaymasterTest();
