import "dotenv/config"
import { getAccountNonce, createSmartAccountClient, ENTRYPOINT_ADDRESS_V07, bundlerActions, getSenderAddress, signUserOperationHashWithECDSA } from "permissionless"
import { Address, createClient, createPublicClient, encodeFunctionData, http } from "viem"
//import { generatePrivateKey, privateKeyToAccount, signMessage } from "viem/accounts"
import { sepolia } from "viem/chains"
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

async function sendUserOperationsTest() {
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
    const txHash = receipt.receipt.transactionHash

    console.log(`UserOperation included: https://sepolia.etherscan.io/tx/${txHash}`);
}

sendUserOperationsTest();
