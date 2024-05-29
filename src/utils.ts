/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { InlineKeyboardButton, Message } from 'node-telegram-bot-api';
import { bot } from './bot';
import axios from 'axios';
import { NFTStatus } from './types';
import { encodeTelegramUrlParameters, isTelegramUrl } from '@tonconnect/sdk';
import { ApolloClient, InMemoryCache, HttpLink, gql, DocumentNode } from '@apollo/client';
import fetch from 'cross-fetch';
export const AT_WALLET_APP_NAME = 'telegram-wallet';

const client = new ApolloClient({
    link: new HttpLink({ uri: process.env.GRAPHQL_ENDPOINT, fetch }),
    cache: new InMemoryCache()
});

export async function delay(MS: number): Promise<any> {
    console.log(MS.toString() + 'ms delay start');
    return new Promise(resolve => {
        return setTimeout(resolve, MS);
    });
}

export async function fetchNftItemsFromCollection(address: string, first: number) {
    const GET_NFT_COLLECTION_ITEMS = gql`
        query ExampleQuery($address: String!, $first: Int!) {
            nftCollectionItems(address: $address, first: $first) {
                cursor
                items {
                    address
                    sale {
                        ... on NftSaleFixPrice {
                            address
                            fullPrice
                        }
                        ... on NftSaleFixPriceDisintar {
                            address
                            fullPrice
                        }
                    }
                }
            }
        }
    `;

    return await runGraphQlQuery(GET_NFT_COLLECTION_ITEMS, { address, first });
}

export async function runGraphQlQuery(query: DocumentNode, variables: object) {
    try {
        const response = await client.query<any>({ query, variables });
        return response;
    } catch (error) {
        console.log('QL error <===', error);
        return null;
    }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export async function replyMessage(
    msg: Message,
    text: string,
    inlineButtons?: InlineKeyboardButton[][]
) {
    await bot
        .editMessageCaption(text, {
            message_id: msg.message_id,
            chat_id: msg.chat.id,
            parse_mode: 'HTML'
        })
        .then(() => {})
        .catch(async () => {
            await bot.editMessageText(text, {
                message_id: msg.message_id,
                chat_id: msg.chat.id,
                parse_mode: 'HTML'
            });
        });
    if (inlineButtons !== undefined)
        await bot.editMessageReplyMarkup(
            { inline_keyboard: inlineButtons! },
            {
                message_id: msg.message_id,
                chat_id: msg.chat.id
            }
        );
}

// Get NFT info from wallet address
// by aurora
export async function getNFTInfo(address: string) {
    const url: string = 'https://toncenter.com/api/v3/nft/items?owner_address=' + address;

    // Define the headers with the API key
    const headers: Record<string, string> = {
        'x-api-key': process.env.TONCENTER_API_KEY!
    };

    const result = await axios.get(url, { headers });
    let nftStatus: NFTStatus = {};

    for (const nft of result.data.nft_items) {
        let collection_address: string = nft.collection_address;
        if (nftStatus[collection_address] === undefined) {
            nftStatus[collection_address] = { ...nft.collection };
        }
        delete nft.collection;
        if (nftStatus[collection_address]?.items === undefined)
            nftStatus[collection_address]!.items = [];
        nftStatus[collection_address]?.items.push({ ...nft });
    }
    return nftStatus;
}

// Get detailed object info from content field in NFT info.
// By aurora
export async function getDetailUri(uri: string) {
    const splited = uri.split('://');
    let resultUri = '';
    if (splited.length === 1) return { error: true };
    else {
        if (splited[0] === 'ipfs') resultUri = `https://ipfs.io/ipfs/${splited[1]!}`;
        else if (splited[0] === 'https' || splited[0] === 'http') resultUri = splited[1]!;
        if (resultUri.slice(-4).toLowerCase() !== 'json') resultUri += '/0.json';

        const ajaxData = await axios.get(resultUri);
        return { ...ajaxData.data, error: false };
    }
}

//ton-connect

export function convertDeeplinkToUniversalLink(link: string, walletUniversalLink: string): string {
    const search = new URL(link).search;
    const url = new URL(walletUniversalLink);

    if (isTelegramUrl(walletUniversalLink)) {
        const startattach = 'tonconnect-' + encodeTelegramUrlParameters(search.slice(1));
        url.searchParams.append('startattach', startattach);
    } else {
        url.search = search;
    }

    return url.toString();
}

export function addTGReturnStrategy(link: string, strategy: string): string {
    const parsed = new URL(link);
    parsed.searchParams.append('ret', strategy);
    link = parsed.toString();

    const lastParam = link.slice(link.lastIndexOf('&') + 1);
    return link.slice(0, link.lastIndexOf('&')) + '-' + encodeTelegramUrlParameters(lastParam);
}

export async function buildUniversalKeyboard(): Promise<InlineKeyboardButton[]> {
    const keyboard = [
        {
            text: 'Scan QR code',
            callback_data: JSON.stringify({ method: 'send_qr' })
        },
        {
            text: 'Choose a Wallet',
            callback_data: JSON.stringify({ method: 'chose_wallet' })
        }
        // {
        //     text: 'Open Link',
        //     url: `https://194.163.169.41/open-tc?connect=${encodeURIComponent(link)}`
        // }
    ];

    // if (atWalletLink) {
    //     keyboard.unshift({
    //         text: '@wallet',
    //         url: atWalletLink
    //     });
    // }

    return keyboard;
}
