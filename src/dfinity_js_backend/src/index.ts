import { query, update, text, Record, StableBTreeMap, Variant, Vec, None, Some, Ok, Err, ic, Principal, Opt, nat64, Duration, Result, bool, Canister } from "azle";
import { Ledger, binaryAddressFromAddress, binaryAddressFromPrincipal, hexAddressFromPrincipal } from "azle/canisters/ledger";
import { hashCode } from "hashcode";
import { v4 as uuidv4 } from "uuid";



const GymService = Record({
    id: text,
    serviceName: text,
    serviceDescription: text
});

const Gym = Record({
    id: text,
    owner : Principal,
    gymName: text,
    gymImgUrl: text,
    gymLocation: text,
    members : Vec(text),
    gymServices : Vec(GymService)
});

const GymPayload = Record({
    gymName: text,
    gymImgUrl: text,
    gymLocation: text
});

const GymServicePayload = Record({
    serviceName: text,
    serviceDescription: text
});



const Message = Variant({
    NotFound: text,
    InvalidPayload: text,
    PaymentFailed: text,
    PaymentCompleted: text
});



const gymStorage = StableBTreeMap(0, text, Gym);

const ORDER_RESERVATION_PERIOD = 120n; // reservation period in seconds

const icpCanister = Ledger(Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai"));

export default Canister({

getAllGym: query([], Vec(Gym), () =>  {
    return gymStorage.values();
}),


getGymById: query([text], Result(Gym, Message), (id) => {
    const event = gymStorage.get(id);
    if ("None" in event) {
        return Err({ NotFound: `product with id=${id} not found` });
    }
    return Ok(event.Some);
}),

addGym: update([GymPayload], Result(Gym, Message), (payload) => {
    if (typeof payload !== "object" || Object.keys(payload).length === 0) {
        return Err({ NotFound: "invalid payload" })
    }
    const gym = { id: uuidv4(), owner: ic.caller(),   members : [], gymServices : [], ...payload};

    gymStorage.insert(gym.id, gym);
    return Ok(gym);
}),

updateGym: update([Gym], Result(Gym, Message), (payload) => {
    const productOpt = gymStorage.get(payload.id);
    if ("None" in productOpt) {
        return Err({ NotFound: `cannot update the product: product with id=${payload.id} not found` });
    }
    gymStorage.insert(productOpt.Some.id, payload);
    return Ok(payload);
}),

deleteGym: update([text], Result(text, Message), (id) => {
    const deletedProductOpt = gymStorage.remove(id);
    if ("None" in deletedProductOpt) {
        return Err({ NotFound: `cannot delete the product: product with id=${id} not found` });
    }
    return Ok(deletedProductOpt.Some.id);
}),


verifyPayment: query([Principal, nat64, nat64, nat64], bool, async (receiver, amount, block, memo) => {
    return await verifyPaymentInternal(receiver, amount, block, memo);
}),

/*
    a helper function to get address from the principal
    the address is later used in the transfer method
*/
getAddressFromPrincipal: query([Principal], text, (principal) => {
    return hexAddressFromPrincipal(principal, 0);
}),

// not used right now. can be used for transfers from the canister for instances when a marketplace can hold a balance account for users
makePayment: update([text, nat64], Result(Message, Message), async (to, amount) => {
    const toPrincipal = Principal.fromText(to);
    const toAddress = hexAddressFromPrincipal(toPrincipal, 0);
    const transferFeeResponse = await ic.call(icpCanister.transfer_fee, { args: [{}] });
    const transferResult = ic.call(icpCanister.transfer, {
        args: [{
            memo: 0n,
            amount: {
                e8s: amount
            },
            fee: {
                e8s: transferFeeResponse.transfer_fee.e8s
            },
            from_subaccount: None,
            to: binaryAddressFromAddress(toAddress),
            created_at_time: None
        }]
    });
    if ("Err" in transferResult) {
        return Err({ PaymentFailed: `payment failed, err=${transferResult.Err}` })
    }
    return Ok({ PaymentCompleted: "payment completed" });
})

})

function hash(input: any): nat64 {
    return BigInt(Math.abs(hashCode().value(input)));
};



// a workaround to make uuid package work with Azle
globalThis.crypto = {
    // @ts-ignore
    getRandomValues: () => {
        let array = new Uint8Array(32);

        for (let i = 0; i < array.length; i++) {
            array[i] = Math.floor(Math.random() * 256);
        }

        return array;
    }
};

function generateCorrelationId(productId: text): nat64 {
    const correlationId = `${productId}_${ic.caller().toText()}_${ic.time()}`;
    return hash(correlationId);
};

function discardByTimeout(memo: nat64, delay: Duration) {
    ic.setTimer(delay, () => {
        const order = gymStorage.remove(memo);
        console.log(`Order discarded ${order}`);
    });
};

async function verifyPaymentInternal(receiver: Principal, amount: nat64, block: nat64, memo: nat64): Promise<bool> {
    const blockData = await ic.call(icpCanister.query_blocks, { args: [{ start: block, length: 1n }] });
    const tx = blockData.blocks.find((block) => {
        if ("None" in block.transaction.operation) {
            return false;
        }
        const operation = block.transaction.operation.Some;
        const senderAddress = binaryAddressFromPrincipal(ic.caller(), 0);
        const receiverAddress = binaryAddressFromPrincipal(receiver, 0);
        return block.transaction.memo === memo &&
            hash(senderAddress) === hash(operation.Transfer?.from) &&
            hash(receiverAddress) === hash(operation.Transfer?.to) &&
            amount === operation.Transfer?.amount.e8s;
    });
    return tx ? true : false;
};