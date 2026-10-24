import React from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Header } from "./components/Header.tsx";
import { AuthProvider } from "./context/AuthContext.tsx";
import { ThemeProvider } from "./context/ThemeContext.tsx";
import { WalletProvider } from "./context/WalletContext.tsx";
import { AuctioneerDashboardPage } from "./pages/AuctioneerDashboardPage.tsx";
import { LiveAuctionPage } from "./pages/LiveAuctionPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { LotAuditPage } from "./pages/LotAuditPage.tsx";
import { MyBidsPage } from "./pages/MyBidsPage.tsx";
import { ReceiptPage } from "./pages/ReceiptPage.tsx";
import { ShowcasePage } from "./pages/ShowcasePage.tsx";
import { WalletPage } from "./pages/WalletPage.tsx";

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <WalletProvider>
          <BrowserRouter>
            <div className="min-h-screen bg-paper-bg text-paper-text dark:bg-charcoal-bg dark:text-charcoal-text">
              <Header />
              <Routes>
                <Route path="/" element={<ShowcasePage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/wallet" element={<WalletPage />} />
                <Route path="/my-bids" element={<MyBidsPage />} />
                <Route path="/auctioneer" element={<AuctioneerDashboardPage />} />
                <Route path="/lots/:id" element={<LiveAuctionPage />} />
                <Route path="/lots/:id/audit" element={<LotAuditPage />} />
                <Route path="/audit/:id" element={<LotAuditPage />} />
                <Route path="/receipts/:code" element={<ReceiptPage />} />
                <Route path="*" element={<ShowcasePage />} />
              </Routes>
            </div>
          </BrowserRouter>
        </WalletProvider>
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;
