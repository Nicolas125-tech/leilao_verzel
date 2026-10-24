import React from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Header } from "./components/Header.tsx";
import { AuthProvider } from "./context/AuthContext.tsx";
import { ThemeProvider } from "./context/ThemeContext.tsx";
import { WalletProvider } from "./context/WalletContext.tsx";
import { AuctioneerDashboardPage } from "./pages/AuctioneerDashboardPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
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
                <Route path="/auctioneer" element={<AuctioneerDashboardPage />} />
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
