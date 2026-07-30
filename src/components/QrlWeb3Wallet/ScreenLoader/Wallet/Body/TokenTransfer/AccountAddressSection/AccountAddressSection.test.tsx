import { QRL_EXAMPLE_ADDRESS } from "@/constants/address";
import StringUtil from "@/utilities/stringUtil";
import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AccountAddressSection from "./AccountAddressSection";

// Derived from the fixture rather than hardcoded, so the expectation cannot drift
// from the constant. See CIPH-QRLW326-33.
const expectedSplitAddress = (address: string) => {
  const { prefix, addressSplit } = StringUtil.getSplitAddress(address);
  return `${prefix} ${addressSplit.join(" ")}`;
};

describe("AccountAddressSection", () => {
  afterEach(cleanup);

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <AccountAddressSection />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the account address section component", () => {
    renderComponent();

    expect(screen.getByText("Account address")).toBeInTheDocument();
    expect(
      screen.getByText(expectedSplitAddress(QRL_EXAMPLE_ADDRESS)),
    ).toBeInTheDocument();
    expect(screen.getByText("Balance")).toBeInTheDocument();
    expect(screen.getByText("0.0 QRL")).toBeInTheDocument();
  });
});
