import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import RestaurantSplash from "./pages/RestaurantSplash";
import MenuPage from "./pages/MenuPage";
import ItemDetailPage from "./pages/ItemDetailPage";
import CartPage from "./pages/CartPage";
import ConfirmPage from "./pages/ConfirmPage";
import TrackingPage from "./pages/TrackingPage";
import BillPage from "./pages/BillPage";
import KDSPage from "./pages/KDSPage";
import { AdminProvider } from "./contexts/AdminContext";
import AdminLayout from "./pages/admin/AdminLayout";
import MesasPage from "./pages/admin/MesasPage";
import MenuAdminPage from "./pages/admin/MenuAdminPage";
import QRPage from "./pages/admin/QRPage";
import SucursalPage from "./pages/admin/SucursalPage";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/admin" element={<AdminProvider><AdminLayout /></AdminProvider>}>
            <Route index element={<Navigate to="/admin/mesas" replace />} />
            <Route path="mesas" element={<MesasPage />} />
            <Route path="menu" element={<MenuAdminPage />} />
            <Route path="qr" element={<QRPage />} />
            <Route path="sucursal" element={<SucursalPage />} />
          </Route>
          <Route path="/:slug" element={<RestaurantSplash />} />
          <Route path="/:slug/menu" element={<MenuPage />} />
          <Route path="/:slug/item/:id" element={<ItemDetailPage />} />
          <Route path="/:slug/cart" element={<CartPage />} />
          <Route path="/:slug/confirm" element={<ConfirmPage />} />
          <Route path="/:slug/tracking" element={<TrackingPage />} />
          <Route path="/:slug/bill" element={<BillPage />} />
          <Route path="/kds" element={<KDSPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
