import * as SecureStore from "expo-secure-store";

export async function logout() {
  await SecureStore.deleteItemAsync("sc_token");
  await SecureStore.deleteItemAsync("sc_user");
}