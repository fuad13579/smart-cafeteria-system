import React from "react";
import { TextInput } from "react-native";

export default function Input(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      placeholderTextColor="#52525b"
      {...props}
      style={[
        {
          borderRadius: 14,
          borderWidth: 1,
          borderColor: "#27272a",
          paddingHorizontal: 12,
          paddingVertical: 10,
          color: "#fafafa",
        },
        props.style,
      ]}
    />
  );
}