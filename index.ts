import "dotenv/config"
import { getAccountNonce, createSmartAccountClient, ENTRYPOINT_ADDRESS_V07 } from "permissionless"
import { Address, createPublicClient, http } from "viem"
//import { generatePrivateKey, privateKeyToAccount, signMessage } from "viem/accounts"
import { sepolia } from "viem/chains"
import { createPimlicoBundlerClient, createPimlicoPaymasterClient } from "permissionless/clients/pimlico";
import { privateKeyToSimpleSmartAccount, privateKeyToSafeSmartAccount } from "permissionless/accounts";

const apiKey = "dfc7d1e4-804b-41dc-9be5-57084b57ea73";
const paymasterUrl = `https://api.pimlico.io/v2/sepolia/rpc?apikey=${apiKey}`;

const privateKey = "0xb273a4b1cfde72170a1ff120127e9ff1d4304328b6ed055b85f140190968682b";

export const publicClient = createPublicClient({
    transport: http("https://rpc.ankr.com/eth_sepolia"),
})

export const paymasterClient = createPimlicoPaymasterClient({
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