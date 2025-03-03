import { EVENTS, KEYRING_CLASS } from '@/constant';
import eventBus from '@/eventBus';
import { noop, useCommonPopupView, useWallet } from '@/ui/utils';
import { DEFAULT_BRIDGE } from '@rabby-wallet/eth-walletconnect-keyring';
import React from 'react';
import { Account } from 'background/service/preference';
import Scan from '@/ui/views/Approval/components/WatchAddressWaiting/Scan';
import { useSessionStatus } from './useSessionStatus';
import { useDisplayBrandName } from './useDisplayBrandName';
import { message } from 'antd';

export const ReconnectView: React.FC = () => {
  const wallet = useWallet();
  const {
    setTitle: setPopupViewTitle,
    setHeight,
    setClassName,
    closePopup,
    visible,
    account,
  } = useCommonPopupView();
  const [qrCodeContent, setQRcodeContent] = React.useState('');
  const [currentAccount, setCurrentAccount] = React.useState<Account | null>(
    null
  );
  const { status, errorAccount } = useSessionStatus(account);
  const [bridgeURL, setBridge] = React.useState<string>(DEFAULT_BRIDGE);
  const [displayBrandName] = useDisplayBrandName(
    account?.realBrandName || account?.brandName
  );

  const initWalletConnect = async () => {
    eventBus.addEventListener(EVENTS.WALLETCONNECT.INITED, ({ uri }) => {
      setQRcodeContent(uri);
    });
    if (account && ['CONNECTED', 'DISCONNECTED'].includes(status as string)) {
      await wallet.killWalletConnectConnector(
        account.address,
        account.brandName,
        true,
        true
      );
    }
    eventBus.emit(EVENTS.broadcastToBackground, {
      method: EVENTS.WALLETCONNECT.INIT,
      data: account,
    });
  };

  const handleRefreshQrCode = () => {
    initWalletConnect();
  };

  const init = async () => {
    if (!account) return;
    const bridge = await wallet.getWalletConnectBridge(
      account.address,
      account.brandName
    );
    setCurrentAccount({
      ...account,
      brandName: account.realBrandName || account.brandName,
      type: KEYRING_CLASS.WALLETCONNECT,
    });
    setBridge(bridge || DEFAULT_BRIDGE);
    setPopupViewTitle(`Connect with ${displayBrandName}`);
    setHeight(420);
    setClassName('isConnectView');
    initWalletConnect();
  };

  React.useEffect(() => {
    init();
  }, []);

  React.useEffect(() => {
    if (visible) {
      initWalletConnect();
    }
  }, [visible]);

  React.useEffect(() => {
    if (status === 'CONNECTED') {
      message.success({
        type: 'success',
        content: 'Connected',
      });
      closePopup();
    } else if (account && errorAccount && status === 'ACCOUNT_ERROR') {
      wallet.killWalletConnectConnector(
        errorAccount.address,
        errorAccount.brandName,
        true,
        true
      );
    }
  }, [account, errorAccount, status]);

  return (
    <div className="watchaddress">
      {currentAccount && (
        <Scan
          uri={qrCodeContent}
          bridgeURL={bridgeURL}
          onRefresh={handleRefreshQrCode}
          defaultBridge={DEFAULT_BRIDGE}
          account={currentAccount}
          onBridgeChange={noop}
        />
      )}
    </div>
  );
};
