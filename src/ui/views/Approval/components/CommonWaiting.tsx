import React from 'react';
import { useApproval, useCommonPopupView, useWallet } from 'ui/utils';
import {
  CHAINS,
  EVENTS,
  HARDWARE_KEYRING_TYPES,
  KEYRING_CATEGORY_MAP,
  WALLETCONNECT_STATUS_MAP,
  WALLET_BRAND_CONTENT,
} from 'consts';
import {
  ApprovalPopupContainer,
  Props as ApprovalPopupContainerProps,
} from './Popup/ApprovalPopupContainer';
import { Account } from 'background/service/preference';
import stats from '@/stats';
import eventBus from '@/eventBus';
import { matomoRequestEvent } from '@/utils/matomo-request';
import { adjustV } from '@/ui/utils/gnosis';
import { message } from 'antd';

interface ApprovalParams {
  address: string;
  chainId?: number;
  isGnosis?: boolean;
  data?: string[];
  account?: Account;
  $ctx?: any;
  extra?: Record<string, any>;
  type: string;
}

export const CommonWaiting = ({ params }: { params: ApprovalParams }) => {
  const wallet = useWallet();
  const { setTitle, setVisible, closePopup } = useCommonPopupView();
  const [getApproval, resolveApproval, rejectApproval] = useApproval();
  const { type } = params;
  const { brandName } = Object.keys(HARDWARE_KEYRING_TYPES)
    .map((key) => HARDWARE_KEYRING_TYPES[key])
    .find((item) => item.type === type);
  const [errorMessage, setErrorMessage] = React.useState('');
  const chain = Object.values(CHAINS).find(
    (item) => item.id === (params.chainId || 1)
  )!;
  const [connectStatus, setConnectStatus] = React.useState(
    WALLETCONNECT_STATUS_MAP.WAITING
  );
  const [result, setResult] = React.useState('');
  const [isClickDone, setIsClickDone] = React.useState(false);
  const [signFinishedData, setSignFinishedData] = React.useState<{
    data: any;
    approvalId: string;
  }>();
  const [statusProp, setStatusProp] = React.useState<
    ApprovalPopupContainerProps['status']
  >('SENDING');
  const [content, setContent] = React.useState('');
  const [description, setDescription] = React.useState('');

  const handleRetry = async () => {
    const account = await wallet.syncGetCurrentAccount()!;
    setConnectStatus(WALLETCONNECT_STATUS_MAP.WAITING);
    await wallet.requestKeyring(account?.type || '', 'resend', null);
    message.success('Resent');
  };

  const handleCancel = () => {
    rejectApproval('user cancel');
  };

  const brandContent = React.useMemo(() => {
    switch (brandName) {
      case HARDWARE_KEYRING_TYPES.BitBox02.brandName:
        return WALLET_BRAND_CONTENT.BITBOX02;
      case HARDWARE_KEYRING_TYPES.GridPlus.brandName:
        return WALLET_BRAND_CONTENT.GRIDPLUS;
      case HARDWARE_KEYRING_TYPES.Onekey.brandName:
        return WALLET_BRAND_CONTENT.ONEKEY;
      case HARDWARE_KEYRING_TYPES.Trezor.brandName:
        return WALLET_BRAND_CONTENT.TREZOR;
      default:
        break;
    }
  }, [brandName]);

  const init = async () => {
    const account = params.isGnosis
      ? params.account!
      : (await wallet.syncGetCurrentAccount())!;
    const approval = await getApproval();

    const isSignText = params.isGnosis
      ? true
      : approval?.data.approvalType !== 'SignTx';
    if (!isSignText) {
      const signingTxId = approval.data.params.signingTxId;
      if (signingTxId) {
        const signingTx = await wallet.getSigningTx(signingTxId);

        if (!signingTx?.explain) {
          setErrorMessage('Failed to get explain');
          return;
        }

        const explain = signingTx.explain;

        stats.report('signTransaction', {
          type: account.brandName,
          chainId: chain.serverId,
          category: KEYRING_CATEGORY_MAP[account.type],
          preExecSuccess: explain
            ? explain?.calcSuccess && explain?.pre_exec.success
            : true,
          createBy: params?.$ctx?.ga ? 'rabby' : 'dapp',
          source: params?.$ctx?.ga?.source || '',
          trigger: params?.$ctx?.ga?.trigger || '',
        });
      }
    } else {
      stats.report('startSignText', {
        type: account.brandName,
        category: KEYRING_CATEGORY_MAP[account.type],
        method: params?.extra?.signTextMethod,
      });
    }

    eventBus.addEventListener(EVENTS.COMMON_HARDWARE.REJECTED, async (data) => {
      setErrorMessage(data);
      setConnectStatus(WALLETCONNECT_STATUS_MAP.FAILD);
    });

    eventBus.addEventListener(EVENTS.SIGN_FINISHED, async (data) => {
      if (data.success) {
        let sig = data.data;
        setResult(sig);
        setConnectStatus(WALLETCONNECT_STATUS_MAP.SIBMITTED);
        if (params.isGnosis) {
          sig = adjustV('eth_signTypedData', sig);
          const sigs = await wallet.getGnosisTransactionSignatures();
          if (sigs.length > 0) {
            await wallet.gnosisAddConfirmation(account.address, data.data);
          } else {
            await wallet.gnosisAddSignature(account.address, data.data);
            await wallet.postGnosisTransaction();
          }
        }
        matomoRequestEvent({
          category: 'Transaction',
          action: 'Submit',
          label: brandName,
        });
        setSignFinishedData({
          data: sig,
          approvalId: approval.id,
        });
      } else {
        setConnectStatus(WALLETCONNECT_STATUS_MAP.FAILD);
      }
    });
  };

  React.useEffect(() => {
    setTitle(`Sign with ${brandName}`);
    init();
  }, []);

  React.useEffect(() => {
    if (signFinishedData && isClickDone) {
      closePopup();
      resolveApproval(
        signFinishedData.data,
        false,
        false,
        signFinishedData.approvalId
      );
    }
  }, [signFinishedData, isClickDone]);

  React.useEffect(() => {
    setVisible(true);
    switch (connectStatus) {
      case WALLETCONNECT_STATUS_MAP.WAITING:
        setStatusProp('SENDING');
        setContent('Sending signing request...');
        setDescription('');
        break;
      case WALLETCONNECT_STATUS_MAP.FAILD:
        setStatusProp('REJECTED');
        setContent('Transaction rejected');
        setDescription(errorMessage);
        break;
      case WALLETCONNECT_STATUS_MAP.SIBMITTED:
        setStatusProp('RESOLVED');
        setContent('Signature completed');
        setDescription('');
        break;
      default:
        break;
    }
  }, [connectStatus, errorMessage]);

  if (!brandContent) {
    throw new Error(`${brandName} is not supported`);
  }

  return (
    <ApprovalPopupContainer
      brandUrl={brandContent.icon}
      status={statusProp}
      onRetry={handleRetry}
      content={content}
      description={description}
      onDone={() => setIsClickDone(true)}
      onCancel={handleCancel}
      hasMoreDescription={!!errorMessage}
    />
  );
};
