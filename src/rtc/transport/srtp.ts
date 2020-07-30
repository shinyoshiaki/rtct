import { SrtpSession } from "../../vendor/rtp/srtp/srtp";
import Event from "rx.mini";
import { RtpHeader, RtpPacket } from "../../vendor/rtp/rtp/rtp";
import { SrtcpSession } from "../../vendor/rtp/srtp/srtcp";
import { RtcpPacket, RtcpPacketConverter } from "../../vendor/rtp/rtcp/rtcp";
import { RTCDtlsTransport } from "./dtls";

export class RTCSrtpTransport {
  srtp: SrtpSession;
  onSrtp = new Event<RtpPacket>();
  srtcp: SrtcpSession;
  onSrtcp = new Event<RtcpPacket[]>();
  iceTransport = this.dtlsTransport.iceTransport;

  constructor(public dtlsTransport: RTCDtlsTransport) {
    const dtls = dtlsTransport.dtls;
    const {
      localKey,
      localSalt,
      remoteKey,
      remoteSalt,
    } = dtls.extractSessionKeys();
    const config = {
      keys: {
        localMasterKey: localKey,
        localMasterSalt: localSalt,
        remoteMasterKey: remoteKey,
        remoteMasterSalt: remoteSalt,
      },
      profile: dtls.srtp.srtpProfile,
    };
    this.srtp = new SrtpSession(config);
    this.srtcp = new SrtcpSession(config);

    this.iceTransport.connection.onData.subscribe((data) => {
      if (!isMedia(data)) return;
      if (isRtcp(data)) {
        const dec = this.srtcp.decrypt(data);
        const srtcp = RtcpPacketConverter.deSerialize(dec);
        this.onSrtcp.execute(srtcp);
      } else {
        const dec = this.srtp.decrypt(data);
        const rtp = RtpPacket.deSerialize(dec);
        this.onSrtp.execute(rtp);
      }
    });
  }

  sendRtp(rawRtp: Buffer, header?: RtpHeader) {
    const enc = this.srtp.encrypt(rawRtp, header);
    this.iceTransport.connection.send(enc);
  }

  sendRtcp(packets: RtcpPacket[]) {
    const payload = Buffer.concat(packets.map((packet) => packet.serialize()));
    const enc = this.srtcp.encrypt(payload);
    this.iceTransport.connection.send(enc);
  }
}

function isMedia(data: Buffer) {
  return data[0] > 127 && data[0] < 192;
}

function isRtcp(buf: Buffer) {
  return buf.length >= 2 && buf[1] >= 192 && buf[1] <= 208;
}

class RtpRouter {}