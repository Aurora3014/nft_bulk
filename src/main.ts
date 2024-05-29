/* eslint-disable @typescript-eslint/explicit-function-return-type */
import dotenv from 'dotenv';
dotenv.config();

import { bot } from './bot';
import {
    handleConnectCommand,
    handleDisconnectCommand,
    handleStartCommand
} from './commands-handlers';
import { connect, getUserByTelegramID, updateUserState } from './ton-connect/mongo';
import { commandCallback } from './commands-handlers';
import TelegramBot from 'node-telegram-bot-api';
import { initRedisClient } from './ton-connect/storage';
import { walletMenuCallbacks } from './connect-wallet-menu';
import { Address, Cell, beginCell, toNano } from '@ton/ton';
import { getConnector } from './ton-connect/connector';
import bulkSend from './wallet/tx_send';
import { transferNftTxBuilder } from './wallet/nft_tx_builder';
import { getNFTInfo } from './utils';

console.log('========> build end <=========');

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type

const startup = async () => {
    await initRedisClient();
    // await altTokenTableUpdate('dedust');

    // await altTokenTableUpdate('ston');
    // // await deletePoolsCollection();
    // await getDedustPair();
    // await getStonPair();
};
startup();
// setInterval(startup, 600000);
// setTimeout(() => setInterval(dealOrder, 30000), 10000);

async function main(): Promise<void> {
    await connect();
    const callbacks = {
        ...commandCallback,
        ...walletMenuCallbacks
    };

    // ======> Callback Raw text <======
    bot.on('callback_query', async query => {
        if (!query.data) {
            return;
        }

        //Raw string process
        switch (query.data) {
            case 'newStart':
                handleStartCommand(query.message!);
                return;
            case 'connectWallet':
                handleConnectCommand(query.message!);
                return;
            case 'disconnectWallet':
                handleDisconnectCommand(query.message!);
                return;
            default:
                break;
        }
        console.log(query.data);

        //other default button click processing
        let request: { method: string; data: string };

        try {
            request = JSON.parse(query.data);
        } catch {
            return;
        }

        if (!callbacks[request.method as keyof typeof callbacks]) {
            return;
        }

        callbacks[request.method as keyof typeof callbacks](query, request.data);
    });

    // ======> Law text input <======
    // eslint-disable-next-line complexity
    bot.on('text', async (msg: TelegramBot.Message) => {
        if (msg.text === '/start') return;
        let user = await getUserByTelegramID(msg.chat!.id);
        if (!!!user) return;
        //Price input part, prev state is buy/sellNFT
        if (user!.state.state === 'buyNFT' || user!.state.state === 'sellNFT') {
            user!.state.nftColCA = msg.text!;

            await bot.sendPhoto(msg.chat.id, './imgpsh_fullsize_anim.png', {
                caption: `
*${user!.state.isBuy ? `📗` : `📕`} ${user!.state.state}*

Please type in price of NFT`,
                reply_markup: {
                    inline_keyboard: [[{ text: '<< Back', callback_data: 'newStart' }]]
                },
                parse_mode: 'Markdown'
            });
            //update state
            user!.state.state = 'nftColCA';
        } else if (user!.state.state === 'nftColCA') {
            user!.state.price = +msg.text!;
            if (isNaN(user!.state.price)) {
                bot.sendMessage(msg.chat!.id, 'Insufficent Price!');
                return;
            }
            await bot.sendPhoto(msg.chat.id, './imgpsh_fullsize_anim.png', {
                caption: `
*${user!.state.isBuy ? `📗 Buy NFT` : `📕 Sell NFT`}*

Please type in amount of NFT`,
                reply_markup: {
                    inline_keyboard: [[{ text: '<< Back', callback_data: 'newStart' }]]
                },
                parse_mode: 'Markdown'
            });
            //update state
            user!.state.state = 'price';
        } else if (user!.state.state === 'price') {
            //Price input part, prev state is price

            let amount = +msg.text!;
            if (isNaN(amount)) {
                bot.sendMessage(msg.chat!.id, 'Insufficent amount!');
                return;
            }
            //store in BigInt Mode
            user!.state.amount = amount;
            await bot.sendPhoto(msg.chat.id, './imgpsh_fullsize_anim.png', {
                caption: `
*${user!.state.isBuy ? `📗` : `📕`} ${user!.state.state}*

Please confirm.

Warning. 
You should store enough TON in your wallet.
Each tx need 1 TON extra for ton price.
and 0.95 TON will be return to your wallet.
OR tx will be fail.`,
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: 'Yes',
                                callback_data: JSON.stringify({ method: 'confirm', data: 'yes' })
                            },
                            {
                                text: 'No',
                                callback_data: JSON.stringify({ method: 'confirm', data: 'no' })
                            }
                        ],
                        [{ text: '<< Back', callback_data: 'newStart' }]
                    ]
                },
                parse_mode: 'Markdown'
            });
        } else if (user!.state.state === 'withdraw') {
            const amountTon = +msg.text!;
            const connector = await getConnector(msg.chat.id!, false);
            await connector.restoreConnection();
            if (isNaN(amountTon)) {
                bot.sendMessage(msg.chat!.id, 'Insufficent Price!');
                return;
            }
            if (!connector.connected) {
                bot.sendMessage(msg.chat!.id, 'Connect Wallet to Withdraw!');
                return;
            }
            let internalMessages: Cell[] = [];
            internalMessages.push(
                beginCell()
                    .storeUint(0x18, 6) // bounce
                    .storeAddress(Address.parse(connector.wallet?.account.address!))
                    .storeCoins(amountTon * 10 ** 9)
                    .storeUint(0, 1 + 4 + 4 + 64 + 32)
                    .storeBit(0) // We do not have State Init
                    .storeBit(0) // We store Message Body as a reference
                    .endCell()
            );
            await bulkSend(internalMessages, user.secretKey, user.walletAddress);
            bot.sendMessage(msg.chat.id, `Tx is sent\nhttps://tonviewer.com/${user.walletAddress}`);
            await handleStartCommand(msg);
        } else if (user!.state.state === 'withdrawNFT') {
            user!.state.dex = msg.text!;

            await bot.sendPhoto(msg.chat.id, './imgpsh_fullsize_anim.png', {
                caption: `
*Transfer NFT*

Please type in CA of NFT collection`,
                reply_markup: {
                    inline_keyboard: [[{ text: '<< Back', callback_data: 'newStart' }]]
                },
                parse_mode: 'Markdown'
            });
            //update state
            user!.state.state = 'withdrawNftColCA';
        } else if (user!.state.state === 'withdrawNftColCA') {
            user!.state.nftColCA = msg.text!;

            await bot.sendPhoto(msg.chat.id, './imgpsh_fullsize_anim.png', {
                caption: `
*Transfer NFT*

Please type in amount of NFT collection`,
                reply_markup: {
                    inline_keyboard: [[{ text: '<< Back', callback_data: 'newStart' }]]
                },
                parse_mode: 'Markdown'
            });
            //update state
            user!.state.state = 'withdrawNftAmount';
        } else if (user!.state.state === 'withdrawNftAmount') {
            user!.state.amount = +msg.text!;
            if (isNaN(user!.state.amount)) {
                bot.sendMessage(msg.chat.id, 'Invalid amount');
                return;
            }
            let internalMessages: Cell[] = [];
            const nftInfo = await getNFTInfo(user.walletAddress);
            console.log(
                nftInfo[Address.parse(user.state.nftColCA).toRawString()],
                Address.parse(user.state.nftColCA).toRawString()
            );

            if (
                nftInfo[Address.parse(user.state.nftColCA).toRawString().toUpperCase()]?.items!
                    .length === 0
            ) {
                bot.sendMessage(
                    msg.chat.id!,
                    `You have no NFT from that collection.\n Please check collection CA again`
                );
                return;
            }

            for (const nft of nftInfo[
                Address.parse(user.state.nftColCA).toRawString().toUpperCase()
            ]?.items!) {
                const body = await transferNftTxBuilder(user.walletAddress, user!.state.dex);
                internalMessages.push(
                    beginCell()
                        .storeUint(0x18, 6) // bounce
                        .storeAddress(Address.parse(Address.parseRaw(nft.address).toString()))
                        .storeCoins(toNano(0.1))
                        .storeUint(0, 1 + 4 + 4 + 64 + 32)
                        .storeBit(0) // We do not have State Init
                        .storeBit(1) // We store Message Body as a reference
                        .storeRef(body)
                        .endCell()
                );
            }
            await bulkSend(internalMessages, user.secretKey, user.walletAddress);
            bot.sendMessage(
                msg.chat.id!,
                `Tx is sent.\nhttps://tonviewer.com/${user.walletAddress}`
            );
            await handleStartCommand(msg);
        } else {
            return;
        }
        await updateUserState(msg.chat!.id, user!.state);
    });

    // bot.onText(/\/my_wallet/, handleShowMyWalletCommand);

    bot.onText(/\/start/, handleStartCommand);
}
try {
    main();
} catch (error) {
    console.log(error);
}
