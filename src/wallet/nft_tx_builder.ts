/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { Address, Cell, StateInit, storeStateInit } from '@ton/ton';
import { beginCell, internal, toNano } from '@ton/core';

export async function buyNftTxBuilder(tonAmount: bigint, saleContractAddress: string) {
    return internal({
        value: tonAmount,
        to: saleContractAddress,
        body: null
    }).body;
}

export async function saleNftTxBuilder(
    Wallet_Mine: string,
    price: bigint,
    NFT_address: string,
    Royalty_address: string
) {
    const fixPriceV3R2Code = Cell.fromBase64(
        'te6cckECCwEAArkAART/APSkE/S88sgLAQIBIAIDAgFIBAUAfvIw7UTQ0wDTH/pA+kD6QPoA1NMAMMABjh34AHAHyMsAFssfUATPFljPFgHPFgH6AszLAMntVOBfB4IA//7y8AICzQYHAFegOFnaiaGmAaY/9IH0gfSB9AGppgBgYaH0gfQB9IH0AGEEIIySsKAVgAKrAQH30A6GmBgLjYSS+CcH0gGHaiaGmAaY/9IH0gfSB9AGppgBgYOCmE44BgAEqYhOmPhW8Q4YBKGATpn8cIxbMbC3MbK2QV44LJOZlvKAVxFWAAyS+G8BJrpOEBFcCBFd0VYACRWdjYKdxjgthOjq+G6hhoaYPqGAD9gHAU4ADAgB92YIQO5rKAFJgoFIwvvLhwiTQ+kD6APpA+gAwU5KhIaFQh6EWoFKQcIAQyMsFUAPPFgH6AstqyXH7ACXCACXXScICsI4XUEVwgBDIywVQA88WAfoCy2rJcfsAECOSNDTiWnCAEMjLBVADzxYB+gLLaslx+wBwIIIQX8w9FIKAejy0ZSzjkIxMzk5U1LHBZJfCeBRUccF8uH0ghAFE42RFrry4fUD+kAwRlAQNFlwB8jLABbLH1AEzxZYzxYBzxYB+gLMywDJ7VTgMDcowAPjAijAAJw2NxA4R2UUQzBw8AXgCMACmFVEECQQI/AF4F8KhA/y8AkA1Dg5ghA7msoAGL7y4clTRscFUVLHBRWx8uHKcCCCEF/MPRQhgBDIywUozxYh+gLLassfFcs/J88WJ88WFMoAI/oCE8oAyYMG+wBxUGZFFQRwB8jLABbLH1AEzxZYzxYBzxYB+gLMywDJ7VQAlsjLHxPLPyPPFlADzxbKAIIJycOA+gLKAMlxgBjIywUmzxZw+gLLaszJgwb7AHFVUHAHyMsAFssfUATPFljPFgHPFgH6AszLAMntVNZeZYk='
    );

    const marketplaceAddress = Address.parse('EQBYTuYbLf8INxFtD8tQeNk5ZLy-nAX9ahQbG_yl1qQ-GEMS'); // GetGems Address
    const marketplaceFeeAddress = Address.parse('EQCjk1hh952vWaE9bRguFkAhDAL5jj3xj9p0uPWrFBq_GEMS'); // GetGems Address for Fees
    const destinationAddress = Address.parse('EQAIFunALREOeQ99syMbO6sSzM_Fa1RsPD5TBoS0qVeKQ-AR'); // GetGems sale contracts deployer

    const royaltyAddress = Address.parse(Royalty_address);
    const nftAddress = Address.parse(NFT_address);

    const feesData = beginCell()
        .storeAddress(marketplaceFeeAddress)
        // 5% - GetGems fee
        .storeCoins((price / BigInt(100)) * BigInt(5))
        .storeAddress(royaltyAddress)
        // 5% - Royalty, can be changed
        .storeCoins((price / BigInt(100)) * BigInt(5))
        .endCell();

    const saleData = beginCell()
        .storeBit(0) // is_complete
        .storeUint(Math.round(Date.now() / 1000), 32) // created_at
        .storeAddress(marketplaceAddress) // marketplace_address
        .storeAddress(nftAddress) // nft_address
        .storeAddress(Address.parse(Wallet_Mine)) // previous_owner_address - mine
        .storeCoins(price) // full price in nanotons
        .storeRef(feesData) // fees_cell
        .storeBit(0) // can_be_deployed_externally
        .endCell();

    const stateInit: StateInit = {
        code: fixPriceV3R2Code,
        data: saleData
    };
    const stateInitCell = beginCell().store(storeStateInit(stateInit)).endCell();

    // not needed, just for example
    const saleBody = beginCell()
        .storeUint(1, 32) // just accept coins on deploy
        .storeUint(0, 64)
        .endCell();

    const transferNftBody = beginCell()
        .storeUint(0x5fcc3d14, 32) // Opcode for NFT transfer
        .storeUint(0, 64) // query_id
        .storeAddress(destinationAddress) // new_owner
        .storeAddress(Address.parse(Wallet_Mine)) // response_destination for excesses
        .storeBit(0) // we do not have custom_payload
        .storeCoins(toNano('0.2')) // forward_amount
        .storeBit(0) // we store forward_payload is this cell
        // not 32, because we stored 0 bit before | do_sale opcode for deployer
        .storeUint(0x0fe0ede, 31)
        .storeRef(stateInitCell)
        .storeRef(saleBody)
        .endCell();
    return transferNftBody;
    // return await internal({
    //     value: '100000000',
    //     to: NFT_address,
    //     body: transferNftBody
    // }).body;
}

export async function transferNftTxBuilder(Wallet_Mine: string, Wallet_DST: string) {
    const body = beginCell()
        .storeUint(0x5fcc3d14, 32) // NFT transfer op code 0x5fcc3d14
        .storeUint(0, 64) // query_id:uint64
        .storeAddress(Address.parse(Wallet_DST)) // new_owner:MsgAddress
        .storeAddress(Address.parse(Wallet_Mine)) // response_destination:MsgAddress
        .storeUint(0, 1) // custom_payload:(Maybe ^Cell)
        .storeCoins(toNano('0.05')) // forward_amount:(VarUInteger 16)
        .storeUint(0, 1) // forward_payload:(Either Cell ^Cell)
        .endCell();

    return body;
}

// ( async () => { await buyNFT(mnemonic.split(','), BigInt(1600000000), 'EQD9d0NIPB9FUm_Us3ym6ZOBsCp8bvkWhTquPHDnMpJ72NoN') })()
// ( async () => {
//     const nftAddresses = [
//         'EQD9ELG9tbeJIILmGzsDhd1P6qtQynkJcSyE3V6Rcxho30MH',
//         'EQCfZGjoHtxbQ9Bv3yn23mFZxESQGjOR3ll-756Ve9BriwS6',
//         'EQCtgdw6fxfMGvJYIxUxtzPXZm3PCZ6lqJ5bmywE4EoweJDp',
//         'EQCTLr-8p-z5VJlQKpEqFigXTI1dHzw5oL4ymW56cWAA18Yp',
//         'EQAlJyg1C4s9EvILpwuN2SZPC2z80Hh6WKCEHo92Cg4IE8r3',
//         'EQAB4fU95c8akUOc8bBWrnsiCpIH6Qfask-0IdQojrIgQ8kf'
//     ]
//     nftAddresses.map(async (nft) => {
//         await buyNFT(mnemonic.split(','), BigInt(100000000), nft);
//     })
//     })()
