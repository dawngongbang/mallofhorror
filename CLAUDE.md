# Mall of Horror Online - Claude Code 프로젝트 설정

## 프로젝트 개요
몰오브호러(Mall of Horror) 보드게임의 웹 기반 온라인 멀티플레이어 구현체.
별도 서버 없이 Firebase/Supabase 등 BaaS(Backend-as-a-Service)를 활용해 친구들과 실시간 플레이 가능.

## 기술 스택 (예정)
- **Frontend**: React + TypeScript + Vite
- **실시간 통신**: Firebase Realtime Database (무료 플랜)
- **호스팅**: Vercel 또는 GitHub Pages (무료)
- **상태 관리**: Zustand
- **스타일**: Tailwind CSS

## 코드 컨벤션
- 언어: TypeScript strict mode
- 컴포넌트: 함수형 컴포넌트 + hooks
- 파일명: PascalCase (컴포넌트), camelCase (유틸/훅)
- 한국어 주석 허용

## 게임 도메인 용어
- 생존자(Survivor): 각 플레이어가 조종하는 캐릭터 (인당 3명)
- 구역(Zone): 쇼핑몰 내 영역 (슈퍼마켓, 주차장, 극장 등)
- 좀비(Zombie): 매 턴 침입하는 적
- 투표(Vote): 좀비 침입 시 소수파를 결정하는 핵심 메커니즘

## 개발 우선순위
1. 게임 로직 (순수 함수로 구현, 테스트 용이하게)
2. 실시간 동기화
3. UI/UX

## 배포 규칙
- **푸시할 때마다 반드시 버전을 올린다** (버그 수정이든 기능 추가든 예외 없음)
- 버전은 `package.json`의 `version` 필드를 semver로 관리 (patch 단위 최소)
