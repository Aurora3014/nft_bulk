/* eslint-disable @typescript-eslint/no-explicit-any */
export interface NFTItem {
    address: string;
    collection_address: string;
    owner_address: string;
    init: boolean;
    index: number;
    code_hash: string;
    data_hash: string;
    content: any;
}

export interface Collection {
    address: string;
    owner_address: string;
    last_transaction_lt: number;
    next_item_index: number;
    collection_content: any;
    items: NFTItem[];
}

interface NftSaleFixPrice {
    __typename: 'NftSaleFixPrice';
    address: string;
    fullPrice: number;
}

interface NftSaleFixPriceDisintar {
    __typename: 'NftSaleFixPriceDisintar';
    address: string;
    fullPrice: number;
}

export interface NftItem {
    address: string;
    sale: NftSaleFixPrice | NftSaleFixPriceDisintar;
}

interface NftCollectionItems {
    cursor: string;
    items: NftItem[];
}

// Define the types for your query response
export interface NFTCollection {
    yourQuery: {
        field1: string;
        field2: string;
    };
}

export interface NFTStatus {
    [key: string]: Collection; // Assuming the value is always a string
}
