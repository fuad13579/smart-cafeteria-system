import "react-native-gesture-handler";
import React, { useEffect, useState } from "react";
import { AppState } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as SecureStore from "expo-secure-store";

import LoginScreen from "./src/screens/LoginScreen.tsx";
import MenuScreen from "./src/screens/MenuScreen.tsx";
import CartScreen from "./src/screens/CartScreen.tsx";
import OrderScreen from "./src/screens/OrderScreen.tsx";
import ToastHost from "./components/Toast";

export type RootStackParamList = {
  Login: undefined;
  Menu: undefined;
  Cart: undefined;
  Order: { id: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: "#09090b",
    card: "#09090b",
    border: "#18181b",
    text: "#fafafa",
    primary: "#fafafa",
  },
};

export default function App() {
  const [booting, setBooting] = useState(true);
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    let mounted = true;

    const sync = async () => {
      const t = await SecureStore.getItemAsync("sc_token");
      if (!mounted) return;
      setHasToken(!!t);
      setBooting(false);
    };

    sync();

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") sync();
    });

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  if (booting) return null;

  return (
    <NavigationContainer theme={theme}>
      <React.Fragment>
        <Stack.Navigator
          initialRouteName={hasToken ? "Menu" : "Login"}
          screenOptions={{
            headerStyle: { backgroundColor: "#09090b" },
            headerTintColor: "#fafafa",
            headerShadowVisible: false,
            contentStyle: { backgroundColor: "#09090b" },
          }}
        >
          <Stack.Screen name="Login" component={LoginScreen} options={{ title: "Sign in" }} />
          <Stack.Screen name="Menu" component={MenuScreen} options={{ title: "Menu" }} />
          <Stack.Screen name="Cart" component={CartScreen} options={{ title: "Cart" }} />
          <Stack.Screen name="Order" component={OrderScreen} options={{ title: "Order tracking" }} />
        </Stack.Navigator>
        <ToastHost />
      </React.Fragment>
    </NavigationContainer>
  );
}