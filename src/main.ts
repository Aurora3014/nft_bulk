/* eslint-disable @typescript-eslint/no-explicit-any */
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
import bulkSend from './wallet/tx_send';
import { transferNftTxBuilder } from './wallet/nft_tx_builder';
import { getNFTInfo, getNameFromAddress } from './utils';

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
            if (!Address.isFriendly(msg.text!)) {
                bot.sendMessage(msg.chat.id, 'Invalid address type');
                return;
            }
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
                    inline_keyboard: [
                        [
                            {
                                text: '1',
                                callback_data: JSON.stringify({ method: 'doBuySell', data: 1 })
                            },
                            {
                                text: '2',
                                callback_data: JSON.stringify({ method: 'doBuySell', data: 2 })
                            },
                            {
                                text: '3',
                                callback_data: JSON.stringify({ method: 'doBuySell', data: 3 })
                            }
                        ],
                        [
                            {
                                text: '4',
                                callback_data: JSON.stringify({ method: 'doBuySell', data: 4 })
                            },
                            {
                                text: '5',
                                callback_data: JSON.stringify({ method: 'doBuySell', data: 5 })
                            },
                            {
                                text: '10',
                                callback_data: JSON.stringify({ method: 'doBuySell', data: 10 })
                            }
                        ],
                        [
                            {
                                text: '20',
                                callback_data: JSON.stringify({ method: 'doBuySell', data: 20 })
                            },
                            {
                                text: '50',
                                callback_data: JSON.stringify({ method: 'doBuySell', data: 50 })
                            },
                            {
                                text: '100',
                                callback_data: JSON.stringify({ method: 'doBuySell', data: 100 })
                            }
                        ],
                        [{ text: '<< Back', callback_data: 'newStart' }]
                    ]
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
            if (!Address.isFriendly(msg.text!)) {
                bot.sendMessage(msg.chat.id, 'Invalid Address, Please check your address again');
                return;
            }
            user!.state.nftColCA = msg.text!;

            user!.state.state = 'withdrawAddress';
            await bot.sendMessage(msg.chat.id!, 'Please enter amount of ton to withdraw');
        } else if (user!.state.state === 'withdrawAddress') {
            let user = await getUserByTelegramID(msg.chat.id);
            const amountTon = +msg.text!;
            if (isNaN(amountTon)) {
                bot.sendMessage(msg.chat!.id, 'Insufficent Price!');
                return;
            }
            let internalMessages: Cell[] = [];
            internalMessages.push(
                beginCell()
                    .storeUint(0x18, 6) // bounce
                    .storeAddress(Address.parse(user!.state.nftColCA))
                    .storeCoins(amountTon * 10 ** 9)
                    .storeUint(0, 1 + 4 + 4 + 64 + 32)
                    .storeBit(0) // We do not have State Init
                    .storeBit(0) // We store Message Body as a reference
                    .endCell()
            );
            await bulkSend(internalMessages, user!.secretKey, user!.walletAddress);
            bot.sendMessage(
                msg.chat.id,
                `Tx is sent\nhttps://tonviewer.com/${user!.walletAddress}`
            );
            await handleStartCommand(msg);
        } else if (user!.state.state === 'withdrawNFT') {
            if (!Address.isFriendly(msg.text!)) {
                bot.sendMessage(msg.chat.id, 'Invalid Address, Please check your address again');
                return;
            }
            let buttons: any[] = [];
            user!.state.dex = msg.text!;
            const nftInfo = await getNFTInfo(user!.walletAddress);
            for (const collectionRawAddress in nftInfo) {
                let colName = await getNameFromAddress(
                    Address.parseRaw(collectionRawAddress).toString()
                );

                buttons.push([
                    {
                        text:
                            String(colName?.data.nftCollectionByAddress.name) +
                            ` (${nftInfo[collectionRawAddress]?.items.length})`,
                        callback_data: JSON.stringify({
                            method: 'nftWithdrawAddress',
                            data: colName?.data.nftCollectionByAddress.name
                        })
                    }
                ]);
            }
            buttons.push([{ text: '<< Back', callback_data: 'newStart' }]);

            await bot.sendPhoto(msg.chat.id, './imgpsh_fullsize_anim.png', {
                caption: `
*Transfer NFT*

Please type in CA of NFT collection`,
                reply_markup: {
                    inline_keyboard: buttons
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
