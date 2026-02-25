import * as SecureStore from "expo-secure-store";
import { useCart } from "../store/cart";

export async function logout() {
  await SecureStore.deleteItemAsync("sc_token");
  await SecureStore.deleteItemAsync("sc_user");
  useCart.getState().clear();
}
