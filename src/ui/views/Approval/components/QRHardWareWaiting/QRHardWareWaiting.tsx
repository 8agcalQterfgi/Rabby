import React, { useCallback, useEffect, useMemo, useState } from 'react';
import stats from '@/stats';
import Player from './Player';
import Reader from './Reader';
import {
  CHAINS,
  EVENTS,
  KEYRING_CATEGORY_MAP,
  WALLET_BRAND_CONTENT,
  WALLET_BRAND_TYPES,
} from 'consts';
import eventBus from '@/eventBus';
import { useApproval, useCommonPopupView, useWallet } from 'ui/utils';
import { useHistory } from 'react-router-dom';
import { RequestSignPayload } from '@/background/service/keyring/eth-keystone-keyring';
import { ApprovalPopupContainer } from '../Popup/ApprovalPopupContainer';

enum QRHARDWARE_STATUS {
  SYNC,
  SIGN,
  RECEIVED,
  DONE,
}

const QRHardWareWaiting = ({ params }) => {
  const { setTitle } = useCommonPopupView();
  const [status, setStatus] = useState<QRHARDWARE_STATUS>(
    QRHARDWARE_STATUS.SYNC
  );
  const [signPayload, setSignPayload] = useState<RequestSignPayload>();
  const [getApproval, resolveApproval, rejectApproval] = useApproval();
  const [errorMessage, setErrorMessage] = useState('');
  const [isSignText, setIsSignText] = useState(false);
  const history = useHistory();
  const wallet = useWallet();
  const [walletBrandContent, setWalletBrandContent] = useState(
    WALLET_BRAND_CONTENT[WALLET_BRAND_TYPES.KEYSTONE]
  );
  const [content, setContent] = React.useState('');

  const chain = Object.values(CHAINS).find(
    (item) => item.id === (params.chainId || 1)
  )!.enum;
  const init = useCallback(async () => {
    const approval = await getApproval();
    const account = await wallet.syncGetCurrentAccount()!;
    if (!account) return;
    setTitle('Sign with ' + account.brandName);
    setWalletBrandContent(WALLET_BRAND_CONTENT[account.brandName]);
    setIsSignText(
      params.isGnosis ? true : approval?.data.approvalType !== 'SignTx'
    );
    eventBus.addEventListener(
      EVENTS.QRHARDWARE.ACQUIRE_MEMSTORE_SUCCEED,
      ({ request }) => {
        setSignPayload(request);
      }
    );
    eventBus.addEventListener(EVENTS.SIGN_FINISHED, async (data) => {
      if (data.success) {
        if (params.isGnosis) {
          const sigs = await wallet.getGnosisTransactionSignatures();
          if (sigs.length > 0) {
            await wallet.gnosisAddConfirmation(account.address, data.data);
          } else {
            await wallet.gnosisAddSignature(account.address, data.data);
            await wallet.postGnosisTransaction();
          }
        }
        setStatus(QRHARDWARE_STATUS.DONE);
        resolveApproval(data.data, !isSignText, false, approval.id);
      } else {
        setErrorMessage(data.errorMsg);
        rejectApproval(data.errorMsg);
      }
      // history.push('/');
    });
    await wallet.acquireKeystoneMemStoreData();
  }, []);

  useEffect(() => {
    init();
    return () => {
      eventBus.removeAllEventListeners(EVENTS.SIGN_FINISHED);
      eventBus.removeAllEventListeners(
        EVENTS.QRHARDWARE.ACQUIRE_MEMSTORE_SUCCEED
      );
    };
  }, [init]);

  const handleCancel = () => {
    rejectApproval('User rejected the request.');
  };
  const handleRequestSignature = async () => {
    const account = await wallet.syncGetCurrentAccount()!;
    const approval = await getApproval();
    if (account) {
      if (!isSignText) {
        const signingTxId = approval.data.params.signingTxId;
        // const tx = approval.data?.params;
        if (signingTxId) {
          // const { nonce, from, chainId } = tx;
          // const explain = await wallet.getExplainCache({
          //   nonce: Number(nonce),
          //   address: from,
          //   chainId: Number(chainId),
          // });
          const signingTx = await wallet.getSigningTx(signingTxId);

          if (!signingTx?.explain) {
            setErrorMessage('Failed to get explain');
            return;
          }

          const explain = signingTx.explain;

          stats.report('signTransaction', {
            type: account.brandName,
            chainId: CHAINS[chain].serverId,
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
      setErrorMessage('');
      setStatus(QRHARDWARE_STATUS.SIGN);
    }
  };

  const showErrorChecker = useMemo(() => {
    return errorMessage !== '' && status == QRHARDWARE_STATUS.SIGN;
  }, [errorMessage]);

  const [scanMessage, setScanMessage] = React.useState();
  const handleScan = (scanMessage) => {
    setScanMessage(scanMessage);
    setStatus(QRHARDWARE_STATUS.RECEIVED);
  };

  const handleDone = () => {
    history.push('/');
  };

  const handleSubmit = () => {
    wallet.submitQRHardwareSignature(
      signPayload!.requestId,
      scanMessage!,
      params?.account?.address
    );
  };

  const popupStatus = React.useMemo(() => {
    if (errorMessage) {
      setContent('Transaction failed');
      return 'FAILED';
    }

    if (status === QRHARDWARE_STATUS.RECEIVED) {
      setContent('Signature received');
      return 'SUBMITTING';
    }
    if (status === QRHARDWARE_STATUS.DONE) {
      setContent('Signature completed');
      return 'RESOLVED';
    }
    if ([QRHARDWARE_STATUS.SIGN, QRHARDWARE_STATUS.SYNC].includes(status)) {
      setContent('');
      return;
    }
  }, [status, errorMessage]);

  if (popupStatus) {
    return (
      <ApprovalPopupContainer
        brandUrl={walletBrandContent.icon}
        status={popupStatus}
        content={content}
        description={errorMessage}
        onCancel={handleCancel}
        onRetry={handleRequestSignature}
        onDone={handleDone}
        onSubmit={handleSubmit}
        hasMoreDescription={!!errorMessage}
      />
    );
  }

  return (
    <section>
      <div className="flex justify-center qrcode-scanner">
        {status === QRHARDWARE_STATUS.SYNC && signPayload && (
          <Player
            type={signPayload.payload.type}
            cbor={signPayload.payload.cbor}
            onSign={handleRequestSignature}
            brandName={walletBrandContent.brand}
          />
        )}
        {status === QRHARDWARE_STATUS.SIGN && (
          <Reader
            requestId={signPayload?.requestId}
            setErrorMessage={setErrorMessage}
            brandName={walletBrandContent.brand}
            onScan={handleScan}
          />
        )}
      </div>
    </section>
  );
};

export default QRHardWareWaiting;
