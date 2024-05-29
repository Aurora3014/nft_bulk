/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { Address, Cell } from '@ton/ton';
import { getConnector } from '../ton-connect/connector';

export async function sendTransaction(
    chatId: number,
    targetAddress: string,
    amount: number,
    msg: Cell | null
) {
    try {
        const connector = getConnector(chatId, false);

        await connector.restoreConnection();

        // Replace with your actual wallet address
        const recipientAddress = Address.parse(targetAddress).toRawString();

        // Replace with the amount you want to send (in nanotokens)

        // Send the transaction
        console.log(`tx run\n${amount}`);
        const result = await connector.sendTransaction({
            validUntil: Math.floor(Date.now() / 1000) + 360,
            messages: [
                {
                    address: recipientAddress,
                    amount: amount.toString(),
                    payload: msg != null ? msg.toBoc().toString('base64') : undefined
                }
            ]
        });
        console.log('Transaction sent:', result);
    } catch (error) {
        console.error('Error sending transaction:', error);
    }
}
