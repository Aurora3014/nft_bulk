/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { Address, Cell, Dictionary, beginCell } from '@ton/core';
import { mnemonicToWalletKey, sign } from '@ton/crypto';
import { TonClient } from '@ton/ton';
import * as crypto from 'crypto';

export default async function main(
    internalMessages: Cell[],
    highload_mnemonic: string,
    highload_address: string
) {
    const dictionary = Dictionary.empty<number, Cell>(); // create an empty dictionary with the key as a number and the value as a cell
    for (let i = 0; i < internalMessages.length; i++) {
        const internalMessage = internalMessages[i]; // get our message from an array
        dictionary.set(i, internalMessage!); // save the message in the dictionary
    }

    const queryID = crypto.randomBytes(4).readUint32BE(); // create a random uint32 number, 4 bytes = 32 bits
    const now = Math.floor(Date.now() / 1000); // get current timestamp
    const timeout = 120; // timeout for message expiration, 120 seconds = 2 minutes
    const finalQueryID = (BigInt(now + timeout) << BigInt(32)) + BigInt(queryID); // get our final query_id
    console.log(finalQueryID); // print query_id. With this query_id we can call GET method to check if our request has been processed

    const toSign = beginCell()
        .storeUint(698983191, 32) // subwallet_id
        .storeUint(finalQueryID, 64)
        // Here we create our own method that will save the
        // transaction mode and a reference to the transaction
        .storeDict(dictionary, Dictionary.Keys.Int(16), {
            serialize: (src, buidler) => {
                buidler.storeUint(3, 8); // save transaction mode, mode = 3
                buidler.storeRef(src); // save transaction as reference
            },
            // We won't actually use this, but this method
            // will help to read our dictionary that we saved
            parse: src => {
                let cell = beginCell()
                    .storeUint(src.loadUint(8), 8)
                    .storeRef(src.loadRef())
                    .endCell();
                return cell;
            }
        });

    const highloadMnemonicArray = highload_mnemonic.split(' ');
    const highloadKeyPair = await mnemonicToWalletKey(highloadMnemonicArray); // extract private and public keys from mnemonic
    const highloadWalletAddress = Address.parse(highload_address);

    const signature = sign(toSign.endCell().hash(), highloadKeyPair.secretKey); // get the hash of our message to wallet smart contract and sign it to get signature

    const body = beginCell()
        .storeBuffer(signature) // store signature
        .storeBuilder(toSign) // store our message
        .endCell();

    const externalMessage = beginCell()
        .storeUint(0b10, 2) // indicate that it is an incoming external transaction
        .storeUint(0, 2) // src -> addr_none
        .storeAddress(highloadWalletAddress)
        .storeCoins(0) // Import fee
        .storeBit(0) // We do not have State Init
        .storeBit(1) // We store Message Body as a reference
        .storeRef(body) // Store Message Body as a reference
        .endCell();

    // We do not need a key here as we will be sending 1 request per second
    const client = new TonClient({
        endpoint: 'https://toncenter.com/api/v2/jsonRPC',
        apiKey: process.env.TONCENTER_API_KEY // you can get an api key from @tonapibot bot in Telegram
    });
    console.log('high-load tx is sent');
    client.sendFile(externalMessage.toBoc());
}
