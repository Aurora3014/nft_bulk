import TonConnect from '@tonconnect/sdk';
import { TonConnectStorage } from './storage';
import * as process from 'process';
import { bot } from '../bot';

type StoredConnectorData = {
    connector: TonConnect;
    timeout: ReturnType<typeof setTimeout>;
    onConnectorExpired: ((connector: TonConnect) => void)[];
};

const connectors = new Map<number, StoredConnectorData>();

export function getConnector(
    chatId: number,
    isconnect?: boolean,
    onConnectorExpired?: (connector: TonConnect) => void
): TonConnect {
    let storedItem: StoredConnectorData;
    if (connectors.has(chatId)) {
        storedItem = connectors.get(chatId)!;
        clearTimeout(storedItem.timeout);
    } else {
        storedItem = {
            connector: new TonConnect({
                manifestUrl: process.env.MANIFEST_URL,
                storage: new TonConnectStorage(chatId)
            }),
            onConnectorExpired: []
        } as unknown as StoredConnectorData;
    }
    if (isconnect === true)
        storedItem.connector.onStatusChange(wallet => {
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
    else storedItem.connector.onStatusChange(() => {});
    if (onConnectorExpired) {
        storedItem.onConnectorExpired.push(onConnectorExpired);
    }

    storedItem.timeout = setTimeout(() => {
        if (connectors.has(chatId)) {
            const storedItem = connectors.get(chatId)!;
            storedItem.connector.pauseConnection();
            storedItem.onConnectorExpired.forEach(callback => callback(storedItem.connector));
            connectors.delete(chatId);
        }
    }, Number(process.env.CONNECTOR_TTL_MS));

    connectors.set(chatId, storedItem);
    return storedItem.connector;
}
