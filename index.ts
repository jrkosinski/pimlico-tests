import "dotenv/config"
import { getAccountNonce, ENTRYPOINT_ADDRESS_V06, bundlerActions, UserOperation, ENTRYPOINT_ADDRESS_V07 } from "permissionless"
import { Client, createClient,http, } from "viem"
import { sepolia } from "viem/chains"
import { 
    pimlicoBundlerActions, 
    pimlicoPaymasterActions 
} from "permissionless/actions/pimlico";
import { 
    getAccountInitCode, 
    getAccountAddress, 
    safeConstAddresses, 
    publicClient, 
    signer, 
    encodeCallData, 
    signUserOperation, 
    apiKey
 } from "./lib";

const SPONSORSHIP_POLICY_ID = "sp_green_iron_lad";
const USE_PAYMASTER = true;

export async function createSafeSmartAccount() {
    const bundlerUrl = `https://api.pimlico.io/v1/sepolia/rpc?apikey=${apiKey}`;
    const transportUrl = `https://api.pimlico.io/v2/sepolia/rpc?apikey=${apiKey}`;

    //create bundler client 
    const bundlerClient = createClient({
        transport: http(transportUrl),
        chain: sepolia,
    }).extend(bundlerActions(ENTRYPOINT_ADDRESS_V06)
    ).extend(pimlicoBundlerActions(ENTRYPOINT_ADDRESS_V06)); 
    
    //create paymaster client
    const paymasterClient = createClient({
        transport: http(transportUrl),
        chain: sepolia,
    }).extend(pimlicoPaymasterActions(ENTRYPOINT_ADDRESS_V06));
    
    const initCode = await getAccountInitCode({
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
    
    //get address of ? 
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
    })
    
    //bytecode of contract (counterfactual)
    const contractCode = await publicClient.getBytecode({ address: sender })

    //generate a nonce from account
    const nonce = await getAccountNonce(publicClient as Client, {
        entryPoint: ENTRYPOINT_ADDRESS_V06,
        sender: sender
    }); 
    
    console.log("sender: ", sender);
    console.log("nonce: ", nonce);
    
    //encode data to call function , for user operation
    const callData: `0x${string}` = encodeCallData({
        to: sender,
        data: '0x',
        value: 0n
    });
    
    //create user operation
    const sponsoredUserOperation: UserOperation = {
        sender,
        nonce,
        initCode: contractCode ? '0x' : initCode,
        callData,
        callGasLimit: 1n, // All gas values will be filled by Estimation Response Data.
        verificationGasLimit: 10000n,
        preVerificationGas: 10000n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        paymasterAndData: safeConstAddresses.sepolia.ERC20_PAYMASTER_ADDRESS,
        signature: '0x'
    }

    //estimate gas 
    if (USE_PAYMASTER) {
        const sponsorResult = await paymasterClient.sponsorUserOperation({
            userOperation: sponsoredUserOperation,
            entryPoint: ENTRYPOINT_ADDRESS_V06,
            sponsorshipPolicyId: SPONSORSHIP_POLICY_ID
        })

        sponsoredUserOperation.callGasLimit = sponsorResult.callGasLimit
        sponsoredUserOperation.verificationGasLimit = sponsorResult.verificationGasLimit
        sponsoredUserOperation.preVerificationGas = sponsorResult.preVerificationGas
        sponsoredUserOperation.paymasterAndData = sponsorResult.paymasterAndData
    }
    else {
        const gasEstimate = await bundlerClient.estimateUserOperationGas({
            userOperation: sponsoredUserOperation,
            entryPoint: ENTRYPOINT_ADDRESS_V06
        })
        const maxGasPriceResult = await bundlerClient.getUserOperationGasPrice()
        sponsoredUserOperation.callGasLimit = gasEstimate.callGasLimit
        sponsoredUserOperation.verificationGasLimit = gasEstimate.verificationGasLimit
        sponsoredUserOperation.preVerificationGas = gasEstimate.preVerificationGas
        sponsoredUserOperation.maxFeePerGas = maxGasPriceResult.fast.maxFeePerGas
        sponsoredUserOperation.maxPriorityFeePerGas = maxGasPriceResult.fast.maxPriorityFeePerGas
    }
    
    //sign the operation 
    sponsoredUserOperation.signature = await signUserOperation(
        sponsoredUserOperation,
        signer,
        sepolia.id,
        safeConstAddresses.sepolia.SAFE_4337_MODULE_ADDRESS
    ); 
    
    //submit the operation 
    const userOperationHash = await bundlerClient.sendUserOperation({
        userOperation: sponsoredUserOperation,
        entryPoint: ENTRYPOINT_ADDRESS_V06
    });
}

createSafeSmartAccount();