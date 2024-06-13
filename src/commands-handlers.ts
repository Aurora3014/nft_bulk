/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable unused-imports/no-unused-vars */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { bot } from './bot';
import TelegramBot, { CallbackQuery } from 'node-telegram-bot-api';
import {
    buildUniversalKeyboard,
    delay,
    fetchNftItemsFromCollection,
    getNFTInfo,
    getNameFromAddress,
    getTopNFTCollection,
    replyMessage
} from './utils';
import { createUser, getUserByTelegramID, updateUserState, UserModel } from './ton-connect/mongo';
let newConnectRequestListenersMap = new Map<number, () => void>();
import { TonClient4 } from 'ton';
import mongoose from 'mongoose';
import deployHighload from './wallet/deployWallet';
import { getConnector } from './ton-connect/connector';
import { getWalletInfo } from './ton-connect/wallets';
import { NFTCollections, NftItem } from './types';
import { sendTransaction } from './wallet/v4r2wallet';
import { Address, Cell, beginCell } from '@ton/core';
import { saleNftTxBuilder } from './wallet/nft_tx_builder';
import bulkSend from './wallet/tx_send';
import { TonClient } from '@ton/ton';

const tonClient = new TonClient4({ endpoint: 'https://mainnet-v4.tonhubapi.com' });
const client = new TonClient({
    endpoint: 'https://toncenter.com/api/v2/jsonRPC',
    apiKey: process.env.TONCENTER_API_KEY // you can get an api key from @tonapibot bot in Telegram
});

export const commandCallback = {
    buySellNFT: handleBuySellNFT,
    confirm: handleConfirm,
    showSetting: handleSettingCommand,
    methodConfirm: handleMethodConfirm,
    changeMethod: handleChangeMethod,
    showMyWallet: handleShowMyWalletCommand,
    withdraw: handleWithdrawCommand,
    withdrawNFT: handleWithdrawNFTCommand,
    backup: handleBackupCommand,
    topNFTCollectionBuy,
    topNFTCollectionSell,
    doBuySell,
    nftWithdrawAddress
};

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export async function handleStartCommand(msg: TelegramBot.Message) {
    //update / create user info
    const userId = msg.chat!.id;
    console.log(userId);
    let prevUser = await getUserByTelegramID(userId);

    if (prevUser) {
        //set userstate idle
        await updateUserState(userId, {
            _id: new mongoose.Types.ObjectId(),
            state: 'idle',
            jettons: ['', ''],
            nftColCA: '',
            amount: 0,
            price: 0,
            isBuy: false,
            dex: '',
            walletSecretKey: '',
            mode: prevUser.state.mode
        });
    } else {
        const { CA, mnemonic } = (await deployHighload())!;

        let newUser = await UserModel.create({
            telegramID: msg.chat!.id,
            walletAddress: CA,
            secretKey: mnemonic,
            wallets: [mnemonic],
            mode: '',
            state: {
                state: 'idle',
                jettons: ['', ''],
                nftColCA: '',
                amount: 0,
                price: 0,
                isBuy: false,
                dex: '',
                walletAddress: ''
            }
        });
        await createUser(newUser);
    }
    await bot.sendPhoto(msg.chat.id, './imgpsh_fullsize_anim.png', {
        caption: `
*What can NFT BuySell bot do for you*

- Create High-load wallet for Bulk TX
- 200+ Tx at one time
- Can buy hundreds of NFT at one time

Type /start to start your *NFT BuySell* bot !  `,
        reply_markup: {
            inline_keyboard: [
                // [{ text: '💵 My wallet', callback_data: JSON.stringify({method: ''})}],
                [
                    {
                        text: '📗 Buy NFT',
                        callback_data: JSON.stringify({ method: 'buySellNFT', data: 'buyNFT' })
                    },
                    {
                        text: '📕 Sell NFT',
                        callback_data: JSON.stringify({ method: 'buySellNFT', data: 'sellNFT' })
                    }
                ],
                [
                    {
                        text: '🔨 Tools and Settings',
                        callback_data: JSON.stringify({ method: 'showSetting' })
                    }
                ]
            ]
        },
        parse_mode: 'Markdown'
    });
}

export async function handleBuySellNFT(query: CallbackQuery, _: string) {
    let user = await getUserByTelegramID(query.message?.chat.id!);
    const connector = await getConnector(query.message?.chat.id!);
    await connector.restoreConnection();
    if (!connector.connected && user!.state.mode !== 'no') {
        bot.sendMessage(query.message?.chat.id!, 'Please connect Wallet in settings');
        return;
    }

    user!.state.state = _;
    user!.state.isBuy = _ === 'buyNFT';
    await updateUserState(query.message?.chat.id!, user!.state);
    let buttons: any[] = [];
    if (_ === 'buyNFT') {
        const topnft = await getTopNFTCollection(3);
        const items: NFTCollections[] = topnft!.data.mainPageTopCollection.items;
        let no = 0;
        for (const nftCol of items) {
            buttons.push([
                {
                    text: String(nftCol.collection.name),
                    callback_data: JSON.stringify({
                        method: 'topNFTCollectionBuy',
                        data: no
                    })
                }
            ]);
            no++;
            console.log(nftCol.collection.address!);
        }
    } else {
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
                        method: 'topNFTCollectionSell',
                        data: colName?.data.nftCollectionByAddress.name
                    })
                }
            ]);
        }
        console.log(nftInfo, 'aasdf');
    }
    buttons.push([{ text: '<< Back', callback_data: 'newStart' }]);
    console.log(buttons);
    await replyMessage(
        query.message!,
        `📗 Buy NFT
        
Please type in NFT Collection CA
<a href="https://getgems.io/top-collections">Click here</a> to visit Getgems.io \n\n Your NFT balance in collection CA\n`,
        buttons
    );
}

export async function topNFTCollectionSell(query: CallbackQuery, _: string) {
    let user = await getUserByTelegramID(query.message!.chat!.id);

    const nftInfo = await getNFTInfo(user!.walletAddress);
    for (const collectionRawAddress in nftInfo) {
        let colName = await getNameFromAddress(Address.parseRaw(collectionRawAddress).toString());
        let strName = colName?.data.nftCollectionByAddress.name;
        if (strName === _) {
            user!.state.nftColCA = Address.parseRaw(collectionRawAddress).toString();

            await bot.sendPhoto(query.message!.chat.id, './imgpsh_fullsize_anim.png', {
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

            await updateUserState(query.message!.chat!.id, user!.state);
            break;
        }
    }
}

export async function topNFTCollectionBuy(query: CallbackQuery, _: string) {
    let user = await getUserByTelegramID(query.message!.chat!.id);

    const topnft = await getTopNFTCollection(3);
    const items: NFTCollections[] = topnft!.data.mainPageTopCollection.items;
    let no = 0;
    for (const nftCol of items) {
        if (+_ === no) {
            let address = nftCol.collection.address;
            user!.state.nftColCA = address;

            await bot.sendPhoto(query.message!.chat.id, './imgpsh_fullsize_anim.png', {
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

            await updateUserState(query.message!.chat!.id, user!.state);
            break;
        }
        no++;
    }
}

export async function doBuySell(query: CallbackQuery, _: string) {
    let user = await getUserByTelegramID(query.message!.chat!.id);
    let amount = +_;
    if (isNaN(amount)) {
        bot.sendMessage(query.message!.chat!.id, 'Insufficent amount!');
        return;
    }
    //store in BigInt Mode
    user!.state.amount = amount;
    await bot.sendPhoto(query.message!.chat.id, './imgpsh_fullsize_anim.png', {
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
    await updateUserState(query.message!.chat!.id, user!.state);
}
//main running code here - Buy and sell logic is here :)
//by 4ura
export async function handleConfirm(query: CallbackQuery, _: string) {
    let user = await getUserByTelegramID(query.message?.chat.id!);
    const connector = await getConnector(query.message?.chat.id!, false);
    await connector.restoreConnection();
    if (!connector.connected && user?.state.mode !== 'no') {
        bot.sendMessage(query.message?.chat.id!, 'Please connect Wallet in settings');
        return;
    }
    if (_ === 'yes') {
        let internalMessages: Cell[] = [];

        if (user!.state.isBuy) {
            console.log('confirm buy\n====> Buy action started <====');
            let counter = 0;
            const fetchedNftItems: NftItem[] = (
                await fetchNftItemsFromCollection(user?.state.nftColCA!, 100)
            )?.data.nftCollectionItems.items;
            console.log(user!.state);
            for (const singleNFT of fetchedNftItems) {
                console.log(singleNFT.sale.fullPrice);
                console.log(user!.state);
                if (
                    singleNFT.sale.fullPrice <= user?.state.price! * 10 ** 9 &&
                    counter < user?.state.amount!
                ) {
                    counter++;
                    if (user?.state.mode! !== 'no') {
                        /// =====> Attention! check if user use his wallet or my wallet. now only user wallet <=====

                        await sendTransaction(
                            query.message?.chat.id!,
                            singleNFT.sale.address,
                            Number(singleNFT.sale.fullPrice) + 10 ** 9,
                            null
                        );
                        await delay(60000);
                        console.log(counter, '================================');
                    } else {
                        internalMessages.push(
                            beginCell()
                                .storeUint(0x18, 6) // bounce
                                .storeAddress(Address.parse(singleNFT.sale.address))
                                .storeCoins(Number(singleNFT.sale.fullPrice) + 10 ** 9)
                                .storeUint(0, 1 + 4 + 4 + 64 + 32)
                                .storeBit(0) // We do not have State Init
                                .storeBit(0) // We store Message Body as a reference
                                .endCell()
                        );
                    }
                }
            }
            // if (counter >= user?.state.amount!) break;
        } else {
            console.log('confirm sell\n ====> sell action started <====');
            let nftInfo;
            if (user!.state.mode !== 'no')
                nftInfo = await getNFTInfo(connector.wallet?.account.address!);
            else nftInfo = await getNFTInfo(user?.walletAddress!);

            for (const collectionAddress in nftInfo) {
                console.log(collectionAddress);
                console.log(Address.parse(user?.state.nftColCA!).toRawString());
                if (
                    Address.parse(user?.state.nftColCA!).toRawString().toLowerCase() ===
                    collectionAddress.toLowerCase()
                ) {
                    console.log(collectionAddress);
                    let counter = 0;
                    for (const nft of nftInfo[collectionAddress]?.items!) {
                        console.log(nft.address);
                        counter++;

                        if (user!.state.mode !== 'no') {
                            const nftSaleCell = await saleNftTxBuilder(
                                connector.wallet!.account.address.toString(),
                                BigInt(user?.state.price! * 10 ** 9 + 11000000),
                                Address.parseRaw(nft.address).toString(),
                                Address.parseRaw(
                                    nftInfo[collectionAddress]?.owner_address!
                                ).toString()
                            );
                            await sendTransaction(
                                query.message?.chat.id!,
                                Address.parseRaw(nft.address).toString(),
                                220000000,
                                nftSaleCell
                            );
                            await delay(30000);
                        } else {
                            const nftSaleCell = await saleNftTxBuilder(
                                user!.walletAddress,
                                BigInt(user?.state.price! * 10 ** 9 + 11000000),
                                Address.parseRaw(nft.address).toString(),
                                Address.parseRaw(
                                    nftInfo[collectionAddress]?.owner_address!
                                ).toString()
                            );
                            internalMessages.push(
                                beginCell()
                                    .storeUint(0x18, 6) // bounce
                                    .storeAddress(Address.parseRaw(nft.address))
                                    .storeCoins(220000000)
                                    .storeUint(0, 1 + 4 + 4 + 64 + 32)
                                    .storeBit(0) // We do not have State Init
                                    .storeBit(1) // We store Message Body as a reference
                                    .storeRef(nftSaleCell)
                                    .endCell()
                            );
                        }
                        if (counter >= user?.state.amount!) break;
                    }
                }
            }
        }
        if (user?.state.mode === 'no') {
            await bulkSend(internalMessages, user?.secretKey!, user?.walletAddress!);
            bot.sendMessage(
                query.message!.chat.id,
                `Tx is sent\nhttps://tonviewer.com/${user!.walletAddress}`
            );
        }
    } else {
        handleStartCommand(query.message!);
    }
}

export async function handleChangeMethod(query: CallbackQuery) {
    let user = await getUserByTelegramID(query.message?.chat.id!);
    let walletEmoji;
    if (user?.state.mode !== 'no') walletEmoji = '🐌 your wallet';
    else walletEmoji = '⚡ fast wallet';
    replyMessage(
        query.message!,
        `🔨 Tools and Settings\n
    You're using ${walletEmoji}`,
        [
            // [{text:'📤 Deposit', callback_data:'deposit'},{text:'📥 Withdraw', callback_data:'withdraw'}],
            [
                {
                    text: '🐌 Connected Wallet',
                    callback_data: JSON.stringify({ method: 'methodConfirm', data: 'yes' })
                },
                {
                    text: '⚡ Supported Wallet',
                    callback_data: JSON.stringify({ method: 'methodConfirm', data: 'no' })
                }
            ],
            [{ text: '<< Back', callback_data: JSON.stringify({ method: 'showSetting' }) }]
        ]
    );
}

export async function handleMethodConfirm(query: CallbackQuery, _: string) {
    let user = await getUserByTelegramID(query.message?.chat.id!);
    if (_ === 'yes' || _ === 'no') {
        user!.state.mode = _;
    }
    console.log(_, user?.state!);
    await updateUserState(query.message?.chat.id!, user?.state!);
    await handleChangeMethod(query);
}

export async function handleSettingCommand(query: CallbackQuery, _: string): Promise<void> {
    let user = await getUserByTelegramID(query.message?.chat.id!);
    let walletEmoji;
    if (user?.state.mode !== 'no') walletEmoji = '🐌';
    else walletEmoji = '⚡';
    replyMessage(
        query.message!,
        `🔨 Tools and Settings\n\n
    Please <b>Connect Wallet</b> to <b>Deposit</b> and <b>Start Trading</b>.`,
        [
            // [{text:'📤 Deposit', callback_data:'deposit'},{text:'📥 Withdraw', callback_data:'withdraw'}],
            [
                {
                    text: '👛 My Fast Wallet',
                    callback_data: JSON.stringify({ method: 'showMyWallet' })
                }
            ],
            [
                { text: '🔗 Connect', callback_data: 'connectWallet' },
                { text: '✂️ Disconnect', callback_data: 'disconnectWallet' }
            ],
            [
                { text: '🛟 Backup', callback_data: JSON.stringify({ method: 'backup' }) },
                {
                    text: walletEmoji + ' Wallet Method',
                    callback_data: JSON.stringify({ method: 'changeMethod' })
                }
            ],
            [{ text: '<< Back', callback_data: 'newStart' }]
        ]
    );
}

export async function handleBackupCommand(query: CallbackQuery): Promise<void> {
    const user = await getUserByTelegramID(query.message?.chat!.id!);
    replyMessage(query.message!, `🔨 Tools and Settings\n\n${user?.secretKey}`, [
        [{ text: '<< Back', callback_data: JSON.stringify({ method: 'showSetting' }) }]
    ]);
}

export async function handleDepositCommand(query: CallbackQuery) {
    const user = await getUserByTelegramID(query.message?.chat!.id!);

    replyMessage(
        query.message!,
        `📤 Deposit\n\n💡Your RewardBot Wallet Address is \n<code>${user?.walletAddress}</code>`,
        [[{ text: '<< Back', callback_data: 'setting' }]]
    );
}

export async function handleWithdrawCommand(query: CallbackQuery) {
    const user = await getUserByTelegramID(query.message!.chat!.id);
    user!.state.state = 'withdraw';
    await updateUserState(query.message?.chat.id!, user!.state);
    const balance = await client.getBalance(Address.parse(user!.walletAddress));
    //update state

    await replyMessage(
        query.message!,
        `👛 My Fast Wallet\n\nbalance: ${
            Number(balance) / 10 ** 9
        }TON\nPlease type in withdraw Address`,
        [[{ text: '<< Back', callback_data: JSON.stringify({ method: 'showSetting' }) }]]
    );
}
export async function nftWithdrawAddress(query: CallbackQuery, _: string) {
    let user = await getUserByTelegramID(query.message!.chat!.id);

    const nftInfo = await getNFTInfo(user!.walletAddress);
    for (const collectionRawAddress in nftInfo) {
        let colName = await getNameFromAddress(Address.parseRaw(collectionRawAddress).toString());
        let strName = colName?.data.nftCollectionByAddress.name;
        if (strName === _) {
            user!.state.nftColCA = Address.parseRaw(collectionRawAddress).toString();
            await bot.sendPhoto(query.message!.chat.id, './imgpsh_fullsize_anim.png', {
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

            await updateUserState(query.message!.chat!.id, user!.state);
            break;
        }
    }
}

export async function handleWithdrawNFTCommand(query: CallbackQuery) {
    const user = await getUserByTelegramID(query.message!.chat!.id);
    user!.state.state = 'withdrawNFT';
    await updateUserState(query.message?.chat.id!, user!.state);
    const balance = await client.getBalance(Address.parse(user!.walletAddress));
    //update state

    await replyMessage(
        query.message!,
        `👛 My Fast Wallet\n\nbalance: ${
            Number(balance) / 10 ** 9
        } TON\n\nPlease type in destination wallet Address`,
        [[{ text: '<< Back', callback_data: JSON.stringify({ method: 'showSetting' }) }]]
    );
}

export async function handleShowMyWalletCommand(query: CallbackQuery): Promise<void> {
    let user = await getUserByTelegramID(query.message?.chat.id!);
    const balance = await client.getBalance(Address.parse(user!.walletAddress));
    console.log(balance);

    replyMessage(
        query.message!,
        `👛 My Fast Wallet\n\nAddress: <code>${user!.walletAddress}</code>\nbalance: ${
            Number(balance) / 10 ** 9
        } TON`,
        [
            [
                { text: '⤵️ Withdraw', callback_data: JSON.stringify({ method: 'withdraw' }) },
                { text: '⤴️ Send NFT', callback_data: JSON.stringify({ method: 'withdrawNFT' }) }
            ],
            [{ text: '<< Back', callback_data: JSON.stringify({ method: 'showSetting' }) }]
        ]
    );
}

export async function handleConnectCommand(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    let messageWasDeleted = false;

    newConnectRequestListenersMap.get(chatId)?.();

    const connector = getConnector(chatId, true);

    await connector.restoreConnection();
    if (connector.connected) {
        const connectedName =
            (await getWalletInfo(connector.wallet!.device.appName))?.name ||
            connector.wallet!.device.appName;
        //  await bot.sendMessage(
        //  chatId,
        //  `You have already connect ${connectedName} wallet\nYour address: ${toUserFriendlyAddress(
        //  connector.wallet!.account.address,
        //  connector.wallet!.account.chain === CHAIN.TESTNET
        //  )}\n\n Disconnect wallet firstly to connect a new one`,
        //  {
        //  reply_markup: {
        //  inline_keyboard: [
        //  [{text: '<< Back', callback_data: 'newStart'}, {text: 'Disconnect', callback_data: 'disConnect'}],
        //  [{ text: '👉 Next', callback_data: JSON.stringify({ method: 'nextStep' }) }]
        //  ]
        //  }
        //  }
        //  );

        return;
    }
    connector.onStatusChange(wallet => {
        if (wallet != null) {
            console.log(wallet);
            console.log('asdfasdfasdfasdf');

            bot.sendMessage(
                chatId,
                `You have already connect ${wallet.device.appName} wallet!\n\nPress Next to start.`,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '<< Back', callback_data: 'newStart' },
                                { text: 'Disconnect', callback_data: 'disConnect' }
                            ],
                            [
                                {
                                    text: '👉 Next',
                                    callback_data: 'newStart'
                                }
                            ]
                        ]
                    }
                }
            );
        }
    });

    const unsubscribe = connector.onStatusChange(async wallet => {
        if (wallet) {
            await deleteMessage();
            const walletName =
                (await getWalletInfo(wallet.device.appName))?.name || wallet.device.appName;
            await bot.sendMessage(chatId, `${walletName} wallet connected successfully`);
            unsubscribe();
            newConnectRequestListenersMap.delete(chatId);
        }
        console.log('status change');
    });
    unsubscribe();
    const keyboard = await buildUniversalKeyboard();

    const botMessage = await bot.sendMessage(
        chatId,
        '🔗 Wallet Connect\n\nYou can scan QR code or click button to connect',
        {
            reply_markup: {
                inline_keyboard: [keyboard, [{ text: '<< Back', callback_data: 'newStart' }]]
            }
        }
    );

    let deleteMessage = async (): Promise<void> => {
        if (!messageWasDeleted) {
            messageWasDeleted = true;
            await bot.deleteMessage(chatId, botMessage.message_id);
        }
    };
    unsubscribe();
    newConnectRequestListenersMap.set(chatId, async () => {
        unsubscribe();

        await deleteMessage();

        newConnectRequestListenersMap.delete(chatId);
    });
}

export async function handleDisconnectCommand(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;

    const connector = getConnector(chatId);
    connector.onStatusChange(() => {});
    await connector.restoreConnection();
    if (!connector.connected) {
        await bot.sendMessage(chatId, "✂ Disconnect Wallet\n\n💡You didn't connect a wallet", {
            reply_markup: {
                inline_keyboard: [[{ text: '<< Back', callback_data: 'newStart' }]]
            }
        });
        return;
    }
    try {
        await connector.disconnect();
    } catch (error) {
        console.log(error);
    }

    await bot.sendMessage(chatId, '✂ Disconnect Wallet\n\n💡Wallet has been disconnected', {
        reply_markup: {
            inline_keyboard: [
                [{ text: '<< Back', callback_data: JSON.stringify({ method: 'showSetting' }) }]
            ]
        }
    });
}
