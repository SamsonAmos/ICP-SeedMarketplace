import { Principal } from "@dfinity/principal";
import { transferICP } from "./ledger";

export async function createGym(gym) {
  return window.canister.marketplace.addGym(gym);
}

export async function getAllGyms() {
  try {
    return await window.canister.marketplace.getAllGyms();
  } catch (err) {
    if (err.name === "AgentHTTPResponseError") {
      const authClient = window.auth.client;
      await authClient.logout();
    }
    return [];
  }
}

export async function buyProduct(product) {
  const marketplaceCanister = window.canister.marketplace;
  const orderResponse = await marketplaceCanister.createOrder(product.id);
  const sellerPrincipal = Principal.from(orderResponse.Ok.seller);
  const sellerAddress = await marketplaceCanister.getAddressFromPrincipal(sellerPrincipal);
  const block = await transferICP(sellerAddress, orderResponse.Ok.price, orderResponse.Ok.memo);
  await marketplaceCanister.completePurchase(sellerPrincipal, product.id, orderResponse.Ok.price, block, orderResponse.Ok.memo);
}
