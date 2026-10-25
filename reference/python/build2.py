import cv2, base64, numpy as np
Wp,Hp=1400,941; mm=Wp/210
src=['L1','L2','L4','L5','L6']
border_mm=[0,6,6,6,9]
cols=[(238,227,207),(196,224,207),(192,220,233),(207,210,243),(217,236,244)] # BGR pastel
uris=[]
for i,n in enumerate(src):
    t=cv2.imread(f'{n}.png',-1); t=cv2.resize(t,(Wp,Hp),interpolation=cv2.INTER_AREA)
    if i>0:
        a=t[...,3]; k=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(7,7))
        dil=cv2.dilate(a,k); edge=(dil>0)&(a<128)
        t[edge,:3]=(245,248,250); t[...,3]=np.maximum(a,dil)
        b=int(border_mm[i]*mm); fr=np.ones((Hp,Wp),np.uint8)*255
        inner=np.zeros((Hp,Wp),np.uint8); r=int(4*mm) if i==4 else 0
        cv2.rectangle(inner,(b+r,b),(Wp-b-r,Hp-b),255,-1); cv2.rectangle(inner,(b,b+r),(Wp-b,Hp-b-r),255,-1)
        if r:
            for cx,cy in [(b+r,b+r),(Wp-b-r,b+r),(b+r,Hp-b-r),(Wp-b-r,Hp-b-r)]: cv2.circle(inner,(cx,cy),r,255,-1)
        frame=(fr>0)&(inner==0)
        t[frame,:3]=cols[i]; t[frame,3]=255
        if i==4:
            ring=cv2.dilate(inner,np.ones((5,5),np.uint8))-inner
            t[ring>0,:3]=(60,85,120); t[ring>0,3]=255
            # little hearts/dots along top border
            for x in range(int(Wp*0.2),int(Wp*0.81),int(Wp*0.15)):
                cv2.circle(t,(x,b//2),6,(160,150,235,255),-1)
    ok,buf=cv2.imencode('.webp',t,[cv2.IMWRITE_WEBP_QUALITY,88])
    uris.append('data:image/webp;base64,'+base64.b64encode(buf).decode())
z=[0,5,10,16,22]
names=['① 하늘','② 숲·언덕·집','③ 정원','④ 앞 캐릭터·꽃','⑤ 앞 나무 프레임']
html=open('tpl2.html').read().replace('__URIS__',str(uris)).replace('__Z__',str(z)).replace('__NAMES__',str(names))
open('/mnt/user-data/outputs/paper_theater_preview_v2.html','w').write(html)
print(len(html)//1024,'KB')
